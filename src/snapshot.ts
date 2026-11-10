// Every panel can orchestrate, but only one does the work: whichever panel
// refreshes first after the shared snapshot goes stale reads the registry,
// the reports, git and gh, and writes the snapshot; the others read it.
// The snapshot holds every session, the writer's own included: each panel
// leaves out its own session when it draws.
import type { Hook } from 'claude-code'

import { buildFronts, PAUSE_WINDOW_MS, type Front } from './fronts'
import { fetchGit, type GitInfo } from './git'
import { dismissFronts, readOverrides } from './overrides'
import { branchGone, fetchPr, type PrChip } from './pr'
import { inferReport, parseLive, readLiveSessions, readReports, type Io, type LiveSession } from './registry'
import { parseReport, reportPath, type Report } from './report'

type Engine = Parameters<Hook<'session.start'>>[0]

export const SNAPSHOT_TTL_MS = 15_000

export type Snapshot = {
  v: 1
  at: number
  by: string
  reports: Report[]
  inferred: Report[]
  live: LiveSession[]
  pr: Record<string, PrChip | null>
  git: Record<string, GitInfo | null>
}

export function snapshotPath(home: string): string {
  return `${home}/.claude/pitwall/snapshot.json`
}

function field(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null ? Reflect.get(value, key) : undefined
}

function listOf<T>(value: unknown, parse: (text: string) => T | null): T[] {
  if (!Array.isArray(value)) return []
  return value.map(item => parse(JSON.stringify(item))).filter((item): item is T => item !== null)
}

function recordOf<T>(value: unknown): Record<string, T> {
  // Written by this mod as JSON of its own types; a wrong shape only blanks a chip.
  return typeof value === 'object' && value !== null ? Object.fromEntries(Object.entries(value)) : {}
}

export function parseSnapshot(text: string): Snapshot | null {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return null
  }
  const at = field(data, 'at')
  const by = field(data, 'by')
  if (field(data, 'v') !== 1 || typeof at !== 'number' || typeof by !== 'string') return null
  return {
    v: 1,
    at,
    by,
    reports: listOf(field(data, 'reports'), parseReport),
    inferred: listOf(field(data, 'inferred'), parseReport),
    live: listOf(field(data, 'live'), parseLive),
    pr: recordOf<PrChip | null>(field(data, 'pr')),
    git: recordOf<GitInfo | null>(field(data, 'git')),
  }
}

export async function readSnapshot(io: Io, home: string): Promise<Snapshot | null> {
  try {
    return parseSnapshot(await io.read(snapshotPath(home)))
  } catch {
    return null
  }
}

// Reports of sessions gone for longer than the pause window are deleted, so
// the folder (read on every computed refresh) stays the size of recent work.
async function pruneOld(io: Io, home: string, reports: Report[], live: LiveSession[], now: number): Promise<Report[]> {
  const liveIds = new Set(live.map(one => one.sessionId))
  const old = reports.filter(one => !liveIds.has(one.sessionId) && now - one.updatedAt > PAUSE_WINDOW_MS)
  await Promise.all(old.map(one => io.run(['rm', '-f', reportPath(home, one.sessionId)]).catch(() => null)))
  return reports.filter(one => !old.includes(one))
}

function ownBranch(front: Front): boolean {
  return front.repoRoot !== null && front.branch !== null && !front.id.includes('#session:')
}

async function isOver(io: Io, front: Front, chip: PrChip | null): Promise<boolean> {
  if (front.section !== 'paused' || !ownBranch(front) || front.repoRoot === null || front.branch === null) return false
  return chip?.state === 'MERGED' || branchGone(io, front.repoRoot, front.branch)
}

// The worktree of the front's newest session, against the repo's main line.
async function gitFor(io: Io, front: Front): Promise<GitInfo | null> {
  const [newest] = [...front.sessions].sort((a, b) => b.report.updatedAt - a.report.updatedAt)
  return newest ? fetchGit(io, newest.report.cwd, ownBranch(front)) : null
}

async function prFor(io: Io, front: Front): Promise<PrChip | null> {
  if (!ownBranch(front) || front.repoRoot === null || front.branch === null) return null
  return fetchPr(io, front.repoRoot, front.branch)
}

async function sessionsNow(io: Io, home: string, now: number) {
  const live = await readLiveSessions(io, home)
  const reports = await pruneOld(io, home, await readReports(io, home), live, now)
  const reported = new Set(reports.map(one => one.sessionId))
  const inferred = await Promise.all(live.filter(one => !reported.has(one.sessionId)).map(one => inferReport(io, home, one)))
  return { live, reports, inferred }
}

export async function computeSnapshot($: Engine, io: Io, home: string, now: number): Promise<Snapshot> {
  const { live, reports, inferred } = await sessionsNow(io, home, now)
  const fronts = buildFronts({ reports, inferred, live, overrides: await readOverrides($), now })
  const judged = await Promise.all(
    fronts.map(async front => {
      const pr = await prFor(io, front)
      return { front, pr, over: await isOver(io, front, pr), git: await gitFor(io, front) }
    }),
  )
  await dismissFronts($, judged.filter(one => one.over).map(one => one.front.id), now)
  const snapshot: Snapshot = {
    v: 1,
    at: now,
    by: await $.session.id(),
    reports,
    inferred,
    live,
    pr: Object.fromEntries(judged.map(one => [one.front.id, one.pr])),
    git: Object.fromEntries(judged.map(one => [one.front.id, one.git])),
  }
  await $.fs.write(snapshotPath(home), JSON.stringify(snapshot))
  return snapshot
}
