// Groups session reports into fronts of work and sorts them into the three
// sections of the panel. Pure: the coordinator feeds it what it read.
import type { LiveSession } from './registry'
import type { Report, Waiting } from './report'

export const PAUSE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

// On these branches each session is its own front: unrelated work shares them.
// A detached HEAD names no branch at all.
const SHARED_BRANCHES = new Set(['main', 'master', 'trunk', 'develop', 'HEAD'])
const MAX_ALIAS_HOPS = 10

export type FrontOverrides = {
  aliases: Record<string, string>
  names: Record<string, string>
  dismissed: Record<string, number>
}

export type FrontSession = { report: Report; live: LiveSession | null; reported: boolean }
export type Section = 'waiting' | 'running' | 'paused'

export type Front = {
  id: string
  name: string
  section: Section
  sessions: FrontSession[]
  waiting: Waiting | null
  activity: string | null
  lastActivity: number
  branch: string | null
  repoRoot: string | null
}

export function frontId(report: Report): string {
  const root = report.repoRoot ?? report.cwd
  const shared = report.branch === null || SHARED_BRANCHES.has(report.branch)
  return shared ? `${root}#session:${report.sessionId}` : `${root}#${report.branch}`
}

// A title saved before markers were stripped: "[Image #3]" or "/panel" names nothing.
function cleanTitle(title: string | null): string | null {
  const clean = title?.replace(/\[Image #\d+\]/g, '').trim() ?? ''
  return clean === '' || clean.startsWith('/') ? null : clean
}

// A name the user gave the session by renaming it; one this mod gave (its
// autoName) is a topic and yields to the current topic.
function userName(session: FrontSession | undefined): string | null {
  const live = session?.live
  if (!live || live.nameSource !== 'user') return null
  return live.name === session.report.autoName ? null : live.name
}

function resolveAlias(id: string, aliases: Record<string, string>): string {
  let resolved = id
  for (let hop = 0; hop < MAX_ALIAS_HOPS; hop += 1) {
    const next = aliases[resolved]
    if (next === undefined || next === id) return resolved
    resolved = next
  }
  return resolved
}

function oldestWait(sessions: FrontSession[]): Waiting | null {
  const waits = sessions
    .filter(one => one.live !== null && one.report.state === 'waiting' && one.report.waiting !== null)
    .map(one => one.report.waiting)
    .filter((wait): wait is Waiting => wait !== null)
  return waits.sort((a, b) => a.since - b.since)[0] ?? null
}

function sectionOf(sessions: FrontSession[], waiting: Waiting | null): Section {
  if (waiting !== null) return 'waiting'
  return sessions.some(one => one.live !== null) ? 'running' : 'paused'
}

function newestFirst(sessions: FrontSession[]): FrontSession[] {
  return [...sessions].sort((a, b) => b.report.updatedAt - a.report.updatedAt)
}

function toFront(id: string, sessions: FrontSession[], names: Record<string, string>): Front {
  const [newest] = newestFirst(sessions)
  const report = newest?.report
  const waiting = oldestWait(sessions)
  const ownBranch = report?.branch && !SHARED_BRANCHES.has(report.branch) ? report.branch : null
  return {
    id,
    name: names[id] ?? userName(newest) ?? (report?.topic || null) ?? (report?.aiTitle || null) ?? ownBranch ?? cleanTitle(report?.title ?? null) ?? newest?.live?.name ?? report?.sessionId.slice(0, 8) ?? id,
    section: sectionOf(sessions, waiting),
    sessions,
    waiting,
    activity: newestFirst(sessions).find(one => one.report.activity !== null)?.report.activity ?? null,
    lastActivity: Math.max(...sessions.map(one => one.report.updatedAt)),
    branch: report?.branch ?? null,
    repoRoot: report?.repoRoot ?? null,
  }
}

// An ended session on a shared branch with no title and no activity has
// nothing to recognize it by (a session closed or cleared before any work).
function isGhost(front: Front): boolean {
  return (
    front.id.includes('#session:') &&
    front.sessions.every(one => one.live === null && one.report.title === null && one.report.activity === null)
  )
}

function isVisible(front: Front, overrides: FrontOverrides, now: number): boolean {
  if (front.section !== 'paused') return true
  if (isGhost(front)) return false
  if (now - front.lastActivity > PAUSE_WINDOW_MS) return false
  const dismissedAt = overrides.dismissed[front.id]
  return dismissedAt === undefined || front.lastActivity > dismissedAt
}

function compareFronts(a: Front, b: Front): number {
  const order: Section[] = ['waiting', 'running', 'paused']
  const bySection = order.indexOf(a.section) - order.indexOf(b.section)
  if (bySection !== 0) return bySection
  if (a.section === 'waiting' && a.waiting && b.waiting) return a.waiting.since - b.waiting.since
  return b.lastActivity - a.lastActivity
}

// `inferred` are reports read from the transcripts of live sessions that
// write none of their own.
export function buildFronts(input: {
  reports: Report[]
  inferred: Report[]
  live: LiveSession[]
  overrides: FrontOverrides
  now: number
}): Front[] {
  const liveById = new Map(input.live.map(one => [one.sessionId, one]))
  const groups = new Map<string, FrontSession[]>()
  const add = (report: Report, reported: boolean) => {
    const id = resolveAlias(frontId(report), input.overrides.aliases)
    const live = liveById.get(report.sessionId) ?? null
    groups.set(id, [...(groups.get(id) ?? []), { report, live, reported }])
  }
  input.reports.forEach(report => add(report, true))
  input.inferred.forEach(report => add(report, false))
  return [...groups.entries()]
    .map(([id, sessions]) => toFront(id, sessions, input.overrides.names))
    .filter(front => isVisible(front, input.overrides, input.now))
    .sort(compareFronts)
}
