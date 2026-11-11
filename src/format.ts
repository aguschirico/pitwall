// The words the panel draws for a front. Pure, so the copy is tested apart
// from any surface.
import type { PanelDrill, PanelGit, PanelGroup, PanelRow, PanelView } from '../types'
import type { Front, FrontSession } from './fronts'
import type { GitInfo } from './git'
import type { PrChip } from './pr'
import type { WaitKind } from './report'

export const TAG: Record<WaitKind, string> = {
  decision: 'Decision',
  'ok-push': 'OK push',
  manual: 'Manual',
  review: 'Review',
}

const MINUTE = 60_000
const BEHIND_WARN = 20
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

export function age(ms: number): string {
  if (ms >= DAY) return `${Math.floor(ms / DAY)}d`
  if (ms >= HOUR) return `${Math.floor(ms / HOUR)}h`
  if (ms >= MINUTE) return `${Math.floor(ms / MINUTE)}m`
  return '<1m'
}

export type Line = { tag: string | null; title: string; age: string; detail: string | null; activity: string | null }

export function frontLine(front: Front, now: number): Line {
  const since = front.waiting?.since ?? front.lastActivity
  const elapsed = now - since
  return {
    tag: front.waiting ? TAG[front.waiting.kind] : null,
    title: front.name,
    age: elapsed < MINUTE ? 'now' : `${age(elapsed)} ago`,
    detail: front.waiting ? `→ ${front.waiting.why}` : null,
    activity: front.activity,
  }
}

const CI_WORDS = { pass: 'CI ok', fail: 'CI failing', pending: 'CI running' }
const REVIEW_WORDS: Record<string, string> = { APPROVED: 'approved', CHANGES_REQUESTED: 'changes requested' }

function prWords(pr: PrChip): string[] {
  if (pr.state !== 'OPEN') return [`PR #${pr.number} ${pr.state === 'MERGED' ? 'merged' : 'closed'}`]
  const review = pr.reviewDecision ? REVIEW_WORDS[pr.reviewDecision] : undefined
  return [`PR #${pr.number}`, pr.checks ? CI_WORDS[pr.checks] : null, review ?? null].filter((part): part is string => part !== null)
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}

function gitWords(git: GitInfo): string[] {
  const dirty = git.dirty > 0 ? [`${git.dirty} uncommitted`] : []
  if (git.base === null) return dirty.length > 0 ? dirty : ['no changes']
  const own = git.ahead > 0 ? `${plural(git.ahead, 'commit')} ahead` : 'no commits ahead'
  const base = git.base.replace(/^origin\//, '')
  const rebase = git.behind > BEHIND_WARN ? ' (rebase soon)' : ''
  const behind = git.behind > 0 ? [`${git.behind} behind ${base}${rebase}`] : []
  return [own, ...behind, ...dirty]
}

// The second line of a row: where the branch and its PR stand, in words.
// `branch` leads when the row is named by its topic, so the branch is still seen.
export function summaryLine(pr: PrChip | null, git: GitInfo | null, reported: boolean, branch: string | null = null): string {
  const lead = branch ? [`branch ${branch}`] : []
  const parts = [...lead, ...(pr ? prWords(pr) : []), ...(git ? gitWords(git) : []), ...(reported ? [] : ['no report'])]
  return parts.join(' · ')
}

export type Drill = PanelDrill

export function shortPath(path: string): string {
  return path.split('/').filter(Boolean).slice(-2).join('/')
}

// Where the user goes to answer in person: the session's name and folder.
export function sessionWhere(session: FrontSession): string {
  const name = session.live?.name ?? session.report.sessionId.slice(0, 8)
  return `Session ${JSON.stringify(name)} (${shortPath(session.report.cwd)})`
}

export function drillDown(front: Front): Drill | null {
  const waiting = front.waiting
  if (!waiting) return null
  const holder = front.sessions.find(one => one.report.waiting === waiting) ?? front.sessions[0]
  return {
    question: waiting.question !== '' ? waiting.question : waiting.why,
    options: waiting.options,
    recap: waiting.recap,
    where: holder ? sessionWhere(holder) : '?',
    canRelay: waiting.kind === 'decision' || waiting.kind === 'review',
  }
}

const FILES_SHOWN = 8

export function gitView(info: GitInfo | null): PanelGit | null {
  if (!info) return null
  const sum = (key: 'added' | 'removed') => info.files.reduce((total, file) => total + file[key], 0)
  return {
    chip: info.base === null ? null : `↑${info.ahead} ↓${info.behind}`,
    warn: info.behind > BEHIND_WARN,
    dirty: info.dirty,
    base: info.base,
    files: info.files.slice(0, FILES_SHOWN),
    more: Math.max(0, info.files.length - FILES_SHOWN),
    added: sum('added'),
    removed: sum('removed'),
    commits: info.commits ?? [],
    dirtyFiles: info.dirtyFiles ?? [],
  }
}

function newestSession(front: Front): FrontSession | undefined {
  return [...front.sessions].sort((a, b) => b.report.updatedAt - a.report.updatedAt)[0]
}

// The worktree of the front's newest session: what "Open in VS Code" opens.
function folderOf(front: Front): string | null {
  return newestSession(front)?.report.cwd ?? null
}

// The session the row speaks for: the one whose wait it shows, else the newest.
function speaker(front: Front): FrontSession | undefined {
  const shown = front.waiting
  return (shown && front.sessions.find(one => one.report.waiting?.since === shown.since)) || newestSession(front)
}

export type ViewExtras = { pr?: Record<string, PrChip | null>; git?: Record<string, GitInfo | null> }

// The branch, when the row's name is not already it (a topic or a rename).
function ownBranchShown(front: Front): string | null {
  if (front.id.includes('#session:') || front.branch === null) return null
  return front.name === front.branch ? null : front.branch
}

// A front no session works on, with an open PR, waits on the user's review or merge.
function prWait(front: Front, pr: PrChip | null): PanelRow['detail'] {
  if (front.section === 'waiting' || pr?.state !== 'OPEN') return null
  if (front.sessions.some(one => one.live !== null)) return null
  const ci = pr.checks ? CI_WORDS[pr.checks] : 'no CI'
  return `→ PR #${pr.number} open, ${ci}: needs your review or merge`
}

// Which repository a front belongs to: its main working tree (worktrees
// included), else the folder its session runs in.
function repoKey(front: Front): string {
  return front.repoRoot ?? folderOf(front) ?? front.id
}

// Header colors, none of them the sections' own (warning, success).
const GROUP_COLORS = ['claude', 'permission', 'suggestion', 'planMode', 'autoAccept', 'ide', 'merged', 'remember']

const lastPart = (path: string): string => path.split('/').filter(Boolean).pop() ?? path

// Each repository's header: its folder name, or its last two folders where two
// share a name. Colors follow the labels' order, so a repo keeps its color
// while the same repos are open. One repository on the panel needs no headers.
export function repoGroups(fronts: Front[]): Map<string, PanelGroup> {
  const keys = [...new Set(fronts.map(repoKey))]
  if (keys.length < 2) return new Map()
  const label = (key: string) => (keys.filter(other => lastPart(other) === lastPart(key)).length > 1 ? shortPath(key) : lastPart(key))
  const labels = keys.map(key => ({ key, label: label(key) })).sort((a, b) => a.label.localeCompare(b.label))
  return new Map(labels.map((one, index) => [one.key, { label: one.label, color: GROUP_COLORS[index % GROUP_COLORS.length] ?? 'claude' }]))
}

// A section's rows with each repository's together, the repos in the order
// they first appear (so the oldest wait still leads), each keeping its own order.
function byRepo(rows: PanelRow[]): PanelRow[] {
  const order = [...new Set(rows.map(row => row.group?.label ?? ''))]
  return [...rows].sort((a, b) => order.indexOf(a.group?.label ?? '') - order.indexOf(b.group?.label ?? ''))
}

// Extras are keyed by front id; a front without one gets none.
export function toView(fronts: Front[], now: number, extras: ViewExtras = {}): PanelView {
  const groups = repoGroups(fronts)
  const row = (front: Front): PanelRow => {
    const pr = extras.pr?.[front.id] ?? null
    const git = extras.git?.[front.id] ?? null
    const reported = front.sessions.some(one => one.reported)
    const waitsOnPr = prWait(front, pr)
    const line = frontLine(front, now)
    return {
      id: front.id,
      group: groups.get(repoKey(front)) ?? null,
      ...line,
      tag: waitsOnPr ? 'PR' : line.tag,
      detail: waitsOnPr ?? line.detail,
      summary: summaryLine(pr, git, reported, ownBranchShown(front)),
      message: speaker(front)?.report.lastMessage ?? null,
      steps: speaker(front)?.report.steps ?? [],
      drill: drillDown(front),
      git: gitView(git),
      openPath: folderOf(front),
      canGo: front.sessions.some(one => one.live !== null),
    }
  }
  const rows = fronts.map(front => ({ front, row: row(front) }))
  const waitsOnPr = (one: { front: Front; row: PanelRow }) => one.front.section !== 'waiting' && one.row.tag === 'PR'
  const of = (section: Front['section']) => rows.filter(one => one.front.section === section && !waitsOnPr(one)).map(one => one.row)
  return {
    waiting: byRepo([...of('waiting'), ...rows.filter(waitsOnPr).map(one => one.row)]),
    running: byRepo(of('running')),
    paused: byRepo(of('paused')),
  }
}
