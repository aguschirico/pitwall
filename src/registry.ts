// Reads what the machine knows about its sessions: the registry Claude Code
// keeps of live sessions, the reports the reporter writes, and, for a session
// without a report, the tail of its transcript.
import type { Hook } from 'claude-code'

import { fallbackClassification } from './classify'
import { cutMessage, parseReport, reportDir, type Report } from './report'

type Engine = Parameters<Hook<'session.start'>>[0]

// The little of the engine the registry needs; tests hand in a fake.
export type Io = {
  list: (path: string) => Promise<{ name: string }[]>
  read: (path: string) => Promise<string>
  run: (argv: readonly string[], init?: { cwd?: string }) => Promise<{ exitCode: number; stdout: string }>
}

export function ioFrom($: Engine): Io {
  return {
    list: path => $.fs.list(path),
    read: path => $.fs.read(path),
    run: (argv, init) => $.process.run(argv, init),
  }
}

export type LiveSession = {
  sessionId: string
  name: string
  pid: number
  status: string
  cwd: string
  updatedAt: number
  // 'user' when the session was renamed (by the user, or by this mod's /rename).
  nameSource?: string
}

const TAIL_BYTES = 200_000

async function readJsonFiles(io: Io, dir: string): Promise<string[]> {
  let entries: { name: string }[]
  try {
    entries = await io.list(dir)
  } catch {
    return []
  }
  const texts = await Promise.all(
    entries
      .filter(entry => entry.name.endsWith('.json'))
      .map(entry => io.read(`${dir}/${entry.name}`).catch(() => '')),
  )
  return texts.filter(text => text !== '')
}

export async function readReports(io: Io, home: string): Promise<Report[]> {
  const texts = await readJsonFiles(io, reportDir(home))
  return texts.map(parseReport).filter((report): report is Report => report !== null)
}

export function parseLive(text: string): LiveSession | null {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof data !== 'object' || data === null) return null
  const pick = (key: string): unknown => Reflect.get(data, key)
  const [pid, sessionId, cwd] = [pick('pid'), pick('sessionId'), pick('cwd')]
  if (typeof pid !== 'number' || typeof sessionId !== 'string' || typeof cwd !== 'string') return null
  const name = pick('name')
  const status = pick('status')
  const updatedAt = pick('updatedAt')
  const nameSource = pick('nameSource')
  return {
    sessionId,
    pid,
    cwd,
    name: typeof name === 'string' ? name : sessionId.slice(0, 8),
    status: typeof status === 'string' ? status : 'unknown',
    updatedAt: typeof updatedAt === 'number' ? updatedAt : 0,
    ...(typeof nameSource === 'string' && { nameSource }),
  }
}

async function alivePids(io: Io, pids: number[]): Promise<Set<number>> {
  if (pids.length === 0) return new Set()
  const run = await io.run(['ps', '-p', pids.join(','), '-o', 'pid='])
  return new Set(run.stdout.split('\n').map(line => Number(line.trim())).filter(pid => pid > 0))
}

export async function readLiveSessions(io: Io, home: string): Promise<LiveSession[]> {
  const texts = await readJsonFiles(io, `${home}/.claude/sessions`)
  const sessions = texts.map(parseLive).filter((one): one is LiveSession => one !== null)
  const alive = await alivePids(io, sessions.map(one => one.pid))
  return sessions.filter(one => alive.has(one.pid))
}

export function transcriptPath(home: string, cwd: string, sessionId: string): string {
  return `${home}/.claude/projects/${cwd.replace(/[/.]/g, '-')}/${sessionId}.jsonl`
}

type TranscriptTail = { title: string | null; branch: string | null; cwd: string | null; lastText: string | null }

function textOf(message: unknown): string | null {
  const content: unknown = typeof message === 'object' && message !== null ? Reflect.get(message, 'content') : null
  if (!Array.isArray(content)) return null
  const texts = content
    .map((block: unknown) => (typeof block === 'object' && block !== null ? Reflect.get(block, 'text') : null))
    .filter((text): text is string => typeof text === 'string' && text.trim() !== '')
  return texts.length > 0 ? texts.join('\n') : null
}

function readRow(tail: TranscriptTail, row: Record<string, unknown>): TranscriptTail {
  if (row.type === 'ai-title' && typeof row.aiTitle === 'string') return { ...tail, title: row.aiTitle }
  if (row.type !== 'assistant') return tail
  return {
    ...tail,
    branch: typeof row.gitBranch === 'string' ? row.gitBranch : tail.branch,
    cwd: typeof row.cwd === 'string' ? row.cwd : tail.cwd,
    lastText: textOf(row.message) ?? tail.lastText,
  }
}

export function parseTail(text: string): TranscriptTail {
  let tail: TranscriptTail = { title: null, branch: null, cwd: null, lastText: null }
  for (const line of text.split('\n')) {
    try {
      const row: unknown = JSON.parse(line)
      if (typeof row === 'object' && row !== null && !Array.isArray(row)) tail = readRow(tail, { ...row })
    } catch {
      // The first line of a tail is usually cut; any line that is not JSON is skipped.
    }
  }
  return tail
}

async function repoRootOf(io: Io, cwd: string): Promise<string | null> {
  const run = await io.run(['git', '-C', cwd, 'rev-parse', '--path-format=absolute', '--git-common-dir'])
  const dir = run.stdout.trim()
  if (run.exitCode !== 0 || dir === '') return null
  return dir.endsWith('/.git') ? dir.slice(0, -'/.git'.length) : dir
}

export async function inferReport(io: Io, home: string, live: LiveSession): Promise<Report> {
  const run = await io.run(['tail', '-c', String(TAIL_BYTES), transcriptPath(home, live.cwd, live.sessionId)])
  const tail = parseTail(run.exitCode === 0 ? run.stdout : '')
  const cwd = tail.cwd ?? live.cwd
  const isWaiting = live.status === 'idle' && tail.lastText !== null
  const found = fallbackClassification(tail.lastText ?? '')
  return {
    v: 1,
    sessionId: live.sessionId,
    cwd,
    repoRoot: await repoRootOf(io, cwd),
    branch: tail.branch,
    title: tail.title,
    activity: null,
    state: isWaiting ? 'waiting' : 'running',
    waiting: isWaiting ? { ...found, kind: 'review', since: live.updatedAt, classified: false } : null,
    updatedAt: live.updatedAt,
    lastMessage: tail.lastText === null ? null : cutMessage(tail.lastText),
    aiTitle: tail.title,
    steps: [],
  }
}
