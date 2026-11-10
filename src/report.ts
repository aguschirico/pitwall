// What one session says about itself. The reporter writes one file per
// session; the coordinator reads them all.

// How a permission dialog's wait starts its `why`: the one manual wait a
// message cannot answer.
export const PERMISSION_PREFIX = 'Permission: '

// Where the session runs, from its own environment: how "go" finds its tab.
export type TerminalInfo = {
  program: string | null
  tmuxPane?: string
  kittyWindow?: string
  weztermPane?: string
}

export type WaitKind = 'decision' | 'ok-push' | 'manual' | 'review'

export type Waiting = {
  kind: WaitKind
  why: string
  question: string
  options: string[]
  recap: string
  since: number
  // false while only the first-line fallback says why: such a wait is never relayed
  classified: boolean
}

// idle: the turn ended and the session only reported back, nothing to answer.
export type ReportState = 'running' | 'waiting' | 'idle' | 'ended'

export type Report = {
  v: 1
  sessionId: string
  cwd: string
  repoRoot: string | null
  branch: string | null
  title: string | null
  activity: string | null
  state: ReportState
  waiting: Waiting | null
  updatedAt: number
  // What the session last said, cut to 40 lines, and its last few steps.
  // Optional: reports written before they were kept still parse.
  lastMessage?: string | null
  steps?: string[]
  // What the session works on, and the name this mod last gave the session.
  topic?: string | null
  autoName?: string | null
  // The title Claude Code gave the conversation: what the terminal tab shows.
  aiTitle?: string | null
  terminal?: TerminalInfo | null
}

const WAIT_KINDS: readonly string[] = ['decision', 'ok-push', 'manual', 'review']
const STATES: readonly string[] = ['running', 'waiting', 'idle', 'ended']

export function reportDir(home: string): string {
  return `${home}/.claude/pitwall/reports`
}

export function reportPath(home: string, sessionId: string): string {
  return `${reportDir(home)}/${sessionId}.json`
}

export function serializeReport(report: Report): string {
  return JSON.stringify(report)
}

export function parseReport(text: string): Report | null {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return null
  }
  if (isRecord(data)) data = { lastMessage: null, steps: [], ...data }
  return isReport(data) ? data : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isStringOrNull(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

export function isWaitKind(value: unknown): value is WaitKind {
  return typeof value === 'string' && WAIT_KINDS.includes(value)
}

function isWaiting(value: unknown): value is Waiting {
  if (!isRecord(value)) return false
  return (
    isWaitKind(value.kind) &&
    typeof value.why === 'string' &&
    typeof value.question === 'string' &&
    Array.isArray(value.options) &&
    value.options.every(option => typeof option === 'string') &&
    typeof value.recap === 'string' &&
    typeof value.since === 'number' &&
    typeof value.classified === 'boolean'
  )
}

function isReport(value: unknown): value is Report {
  if (!isRecord(value) || value.v !== 1) return false
  return (
    typeof value.sessionId === 'string' &&
    typeof value.cwd === 'string' &&
    isStringOrNull(value.repoRoot) &&
    isStringOrNull(value.branch) &&
    isStringOrNull(value.title) &&
    isStringOrNull(value.activity) &&
    typeof value.state === 'string' &&
    STATES.includes(value.state) &&
    (value.waiting === null || isWaiting(value.waiting)) &&
    typeof value.updatedAt === 'number' &&
    isStringOrNull(value.lastMessage) &&
    (value.terminal === undefined || value.terminal === null || isRecord(value.terminal)) &&
    Array.isArray(value.steps) &&
    value.steps.every(step => typeof step === 'string')
  )
}

const MESSAGE_LINES = 40
const MESSAGE_CHARS = 4_000

// What the panel shows when the user opens a waiting front.
export function cutMessage(text: string): string {
  const lines = text.trim().split('\n')
  const kept = lines.length > MESSAGE_LINES ? `${lines.slice(0, MESSAGE_LINES).join('\n')}\n…` : lines.join('\n')
  return kept.length > MESSAGE_CHARS ? `${kept.slice(0, MESSAGE_CHARS)}…` : kept
}
