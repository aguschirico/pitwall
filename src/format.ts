// The words the panel draws for a front. Pure, so the copy is tested apart
// from any surface.
import type { PanelDrill, PanelGit, PanelGroup, PanelRow, PanelView } from '../types'
import type { Front, FrontSession } from './fronts'
import type { GitInfo } from './git'
import type { PrChip } from './pr'
import type { WaitKind } from './report'
import { DEFAULT_STUCK_MIN } from './settings'

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

export type Line = { tag: string | null; title: string; age: string; stuck: boolean; detail: string | null; activity: string | null }

// `stuckAfter`: how long a wait on the user goes before the row says it is
// stuck, or null for never. Only a wait counts: a running row is not stuck.
export function isStuck(front: Front, now: number, stuckAfter: number | null): boolean {
  return front.waiting !== null && stuckAfter !== null && now - front.waiting.since >= stuckAfter
}

export function frontLine(front: Front, now: number, stuckAfter: number | null = DEFAULT_STUCK_MIN * MINUTE): Line {
  const since = front.waiting?.since ?? front.lastActivity
  const elapsed = now - since
  const stuck = isStuck(front, now, stuckAfter)
  return {
    tag: front.waiting ? TAG[front.waiting.kind] : null,
    title: front.name,
    age: stuck ? `⏳ stuck ${age(elapsed)}` : elapsed < MINUTE ? 'now' : `${age(elapsed)} ago`,
    stuck,
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

// `pr` and `git` are keyed by front id; a front without one gets none.
// `stuckAfter` is frontLine's, the user's threshold.
export type ViewExtras = { pr?: Record<string, PrChip | null>; git?: Record<string, GitInfo | null>; stuckAfter?: number | null }

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

// A section's rows with each repository's together, the repos in alphabetical
// order as the pane draws them, each keeping its own order.
function byRepo(rows: PanelRow[]): PanelRow[] {
  return [...rows].sort((a, b) => (a.group?.label ?? '').localeCompare(b.group?.label ?? ''))
}

export type RepoPart = { group: PanelGroup; part: PanelView }

// The panel split by repository, the repos in alphabetical order (the order
// toView already sorted each section in), or [] for a single one.
export function repoParts(panel: PanelView): RepoPart[] {
  const groups = new Map<string, PanelGroup>()
  for (const row of [...panel.waiting, ...panel.running, ...panel.idle, ...panel.closed]) if (row.group) groups.set(row.group.label, row.group)
  const of = (rows: PanelRow[], label: string) => rows.filter(row => row.group?.label === label)
  return [...groups.values()]
    .sort((a, b) => a.label.localeCompare(b.label))
    .map(group => ({
      group,
      part: {
        waiting: of(panel.waiting, group.label),
        running: of(panel.running, group.label),
        idle: of(panel.idle, group.label),
        closed: of(panel.closed, group.label),
      },
    }))
}

// Every row in the order the pane draws it.
export function drawnRows(panel: PanelView): PanelRow[] {
  const all = (part: PanelView) => [...part.waiting, ...part.running, ...part.idle, ...part.closed]
  const parts = repoParts(panel)
  return parts.length === 0 ? all(panel) : parts.flatMap(one => all(one.part))
}

// "Waiting on you · 2", and how many of those are stuck when any is.
export function waitingHeader(rows: PanelRow[]): string {
  const stuck = rows.filter(row => row.stuck).length
  return `Waiting on you · ${rows.length}${stuck > 0 ? ` (${stuck} stuck)` : ''}`
}

// Row numbers for /coordinate. A front keeps its number for as long as it is
// on the panel, whatever section it moves to: a number that changed between
// reading the panel and typing it would send the words to another session.
// A new front takes the lowest free number, in the order rows are drawn.
export function assignNumbers(previous: Record<string, number>, rows: PanelRow[]): Record<string, number> {
  const present = new Set(rows.map(row => row.id))
  const kept: Record<string, number> = {}
  for (const [id, number] of Object.entries(previous)) if (present.has(id)) kept[id] = number
  const taken = new Set(Object.values(kept))
  let next = 1
  for (const row of rows) {
    if (kept[row.id] !== undefined) continue
    while (taken.has(next)) next += 1
    kept[row.id] = next
    taken.add(next)
  }
  return kept
}

export function withNumbers(panel: PanelView, numbers: Record<string, number>): PanelView {
  const number = (row: PanelRow): PanelRow => ({ ...row, number: numbers[row.id] ?? 0 })
  return { waiting: panel.waiting.map(number), running: panel.running.map(number), idle: panel.idle.map(number), closed: panel.closed.map(number) }
}

export function toView(fronts: Front[], now: number, extras: ViewExtras = {}): PanelView {
  const groups = repoGroups(fronts)
  const row = (front: Front): PanelRow => {
    const pr = extras.pr?.[front.id] ?? null
    const git = extras.git?.[front.id] ?? null
    const reported = front.sessions.some(one => one.reported)
    const waitsOnPr = prWait(front, pr)
    const line = frontLine(front, now, extras.stuckAfter === undefined ? DEFAULT_STUCK_MIN * MINUTE : extras.stuckAfter)
    return {
      id: front.id,
      number: 0,
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
      canClose: front.section === 'closed',
    }
  }
  const rows = fronts.map(front => ({ front, row: row(front) }))
  const waitsOnPr = (one: { front: Front; row: PanelRow }) => one.front.section !== 'waiting' && one.row.tag === 'PR'
  const of = (section: Front['section']) => rows.filter(one => one.front.section === section && !waitsOnPr(one)).map(one => one.row)
  return {
    waiting: byRepo([...of('waiting'), ...rows.filter(waitsOnPr).map(one => one.row)]),
    running: byRepo(of('running')),
    idle: byRepo(of('idle')),
    closed: byRepo(of('closed')),
  }
}
