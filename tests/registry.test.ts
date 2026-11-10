import { expect, test } from 'claude-code/testing'

import { inferReport, readLiveSessions, readReports, transcriptPath, type Io } from '../src/registry'
import { serializeReport, type Report } from '../src/report'

type Files = Record<string, string>
type Ran = { exitCode: number; stdout: string }

const REPORT: Report = {
  v: 1,
  sessionId: 'a',
  cwd: '/repo',
  repoRoot: '/repo',
  branch: 'feat/x',
  title: null,
  activity: null,
  state: 'running',
  waiting: null,
  updatedAt: 1,
}

const ok = (stdout: string): Ran => ({ exitCode: 0, stdout })

function disk(files: Files, run: (argv: readonly string[]) => Ran = () => ok('')): Io {
  return {
    list: async path =>
      Object.keys(files)
        .filter(file => file.startsWith(`${path}/`))
        .map(file => ({ name: file.slice(path.length + 1) })),
    read: async path => {
      const text = files[path]
      if (text === undefined) throw new Error('ENOENT')
      return text
    },
    run: async argv => run(argv),
  }
}

const DIR = '/h/.claude/pitwall/reports'

test('a half written report between two good ones is skipped', async () => {
  const io = disk({
    [`${DIR}/a.json`]: serializeReport(REPORT),
    [`${DIR}/b.json`]: '{"v":1,"sess',
    [`${DIR}/c.json`]: serializeReport({ ...REPORT, sessionId: 'c' }),
  })
  const reports = await readReports(io, '/h')
  expect(reports.map(one => one.sessionId).sort()).toEqual(['a', 'c'])
})

const SESSION = (pid: number, id: string) =>
  JSON.stringify({ pid, sessionId: id, cwd: '/repo', name: `n${pid}`, status: 'idle', updatedAt: 5 })

test('a registered session whose process is gone is not live', async () => {
  const io = disk(
    { '/h/.claude/sessions/10.json': SESSION(10, 'a'), '/h/.claude/sessions/11.json': SESSION(11, 'b'), '/h/.claude/sessions/10.abc.key': 'k' },
    argv => (argv[0] === 'ps' ? ok('   10\n') : ok('')),
  )
  const lives = await readLiveSessions(io, '/h')
  expect(lives.map(one => one.sessionId)).toEqual(['a'])
})

test('the transcript of a session lives under its start folder', async () => {
  expect(transcriptPath('/h', '/Users/me/src/app/.worktrees/f2.1', 's')).toBe(
    '/h/.claude/projects/-Users-me-src-app--worktrees-f2-1/s.jsonl',
  )
})

test('a session without a report is inferred from its transcript tail', async () => {
  const tail = [
    JSON.stringify({ type: 'ai-title', aiTitle: 'Search handoff' }),
    JSON.stringify({
      type: 'assistant',
      cwd: '/repo/.worktrees/f',
      gitBranch: 'feat/f',
      message: { content: [{ type: 'text', text: '\nShall I push and open a PR?\nrest' }] },
    }),
  ].join('\n')
  const io = disk({}, argv => {
    if (argv[0] === 'tail') return ok(`{"partial line\n${tail}\n`)
    if (argv.includes('--git-common-dir')) return ok('/repo/.git\n')
    return ok('')
  })
  const live = { sessionId: 's', name: 'n', pid: 1, status: 'idle', cwd: '/repo', updatedAt: 7 }
  const inferred = await inferReport(io, '/h', live)

  expect(inferred.title).toBe('Search handoff')
  expect(inferred.branch).toBe('feat/f')
  expect(inferred.repoRoot).toBe('/repo')
  expect(inferred.state).toBe('waiting')
  expect(inferred.waiting?.why).toBe('Shall I push and open a PR?')
})

test('the registry says whether the user named the session', async () => {
  const io = disk(
    { '/h/.claude/sessions/10.json': JSON.stringify({ pid: 10, sessionId: 'a', cwd: '/repo', name: 'Coordinador', nameSource: 'user' }) },
    argv => (argv[0] === 'ps' ? ok('10\n') : ok('')),
  )
  expect((await readLiveSessions(io, '/h'))[0]?.nameSource).toBe('user')
})
