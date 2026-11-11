import { expect, test } from 'claude-code/testing'

import { age, drillDown, frontLine, gitView, repoGroups, summaryLine, toView } from '../src/format'
import type { GitInfo } from '../src/git'
import type { Front, FrontSession } from '../src/fronts'
import type { Report, Waiting } from '../src/report'

const NOW = 1_000_000_000

function session(waiting: Waiting | null, reported = true): FrontSession {
  const report: Report = {
    v: 1,
    sessionId: 's1',
    cwd: '/Users/me/src/app/.worktrees/search',
    repoRoot: '/Users/me/src/app',
    branch: 'feat/search',
    title: 'Search tools',
    activity: 'Bash: pnpm test',
    state: waiting ? 'waiting' : 'running',
    waiting,
    updatedAt: NOW - 60_000,
  }
  const live = { sessionId: 's1', name: 'api-3a', pid: 1, status: 'idle', cwd: report.cwd, updatedAt: NOW }
  return { report, live, reported }
}

function front(waiting: Waiting | null, reported = true): Front {
  return {
    id: '/Users/me/src/app#feat/search',
    name: 'feat/search',
    section: waiting ? 'waiting' : 'running',
    sessions: [session(waiting, reported)],
    waiting,
    activity: 'Bash: pnpm test',
    lastActivity: NOW - 60_000,
    branch: 'feat/search',
    repoRoot: '/Users/me/src/app',
  }
}

const wait = (kind: Waiting['kind']): Waiting => ({
  kind,
  why: 'pide push y PR',
  question: 'Shall I push and open the PR?',
  options: ['yes', 'no'],
  recap: 'tarea 3 hecha',
  since: NOW - 12 * 60_000,
  classified: true,
})

test('ages read in the largest whole unit', async () => {
  expect(age(30_000)).toBe('<1m')
  expect(age(90_000)).toBe('1m')
  expect(age(3 * 3_600_000)).toBe('3h')
  expect(age(2 * 86_400_000)).toBe('2d')
})

test('a front waiting for a push shows the OK push tag and why', async () => {
  const line = frontLine(front(wait('ok-push')), NOW)
  expect(line.tag).toBe('OK push')
  expect(line.age).toBe('12m ago')
  expect(line.detail).toBe('→ pide push y PR')
})

test('a running front has no tag and ages from its last activity', async () => {
  const line = frontLine(front(null), NOW)
  expect(line.tag).toBe(null)
  expect(line.age).toBe('1m ago')
  expect(line.activity).toBe('Bash: pnpm test')
})

test('a front with no reporting session says so', async () => {
  expect(summaryLine(null, null, false)).toBe('no report')
})

test('a manual wait cannot be relayed and names the session to go to', async () => {
  const drill = drillDown(front(wait('manual')))
  expect(drill?.canRelay).toBe(false)
  expect(drill?.where).toBe('Session "api-3a" (.worktrees/search)')
})

test('a decision can be relayed and keeps its options', async () => {
  const drill = drillDown(front(wait('decision')))
  expect(drill?.canRelay).toBe(true)
  expect(drill?.options).toEqual(['yes', 'no'])
  expect(drill?.question).toBe('Shall I push and open the PR?')
})

test('a front that waits for nothing has no drill down', async () => {
  expect(drillDown(front(null))).toBe(null)
})

test('a wait with no literal question shows its why instead', async () => {
  const drill = drillDown(front({ ...wait('manual'), question: '' }))
  expect(drill?.question).toBe('pide push y PR')
})

const GIT: GitInfo = {
  base: 'origin/main',
  ahead: 4,
  behind: 3,
  dirty: 2,
  files: Array.from({ length: 10 }, (_, index) => ({ path: `src/f${index}.ts`, added: 10, removed: 1 })),
}

test('a branch reads as ahead and behind its base', async () => {
  const view = gitView(GIT)
  expect(view?.chip).toBe('↑4 ↓3')
  expect(view?.warn).toBe(false)
  expect(view?.dirty).toBe(2)
})

test('a base more than 20 commits behind is flagged', async () => {
  expect(gitView({ ...GIT, behind: 21 })?.warn).toBe(true)
  expect(gitView({ ...GIT, behind: 20 })?.warn).toBe(false)
})

test('the files list shows eight and counts the rest, with totals', async () => {
  const view = gitView(GIT)
  expect(view?.files.length).toBe(8)
  expect(view?.more).toBe(2)
  expect([view?.added, view?.removed]).toEqual([100, 10])
})

test('a session on the shared branch has no ahead behind chip', async () => {
  expect(gitView({ base: null, ahead: 0, behind: 0, dirty: 1, files: [] })?.chip).toBe(null)
})

test('every row carries its git view and the folder to open', async () => {
  const view = toView([front(null)], NOW, { git: { [front(null).id]: GIT } })
  expect(view.running[0]?.git?.chip).toBe('↑4 ↓3')
  expect(view.running[0]?.openPath).toBe('/Users/me/src/app/.worktrees/search')
})

const OPEN_PR = { number: 128, state: 'OPEN', checks: 'pass', reviewDecision: null } as const

test('the summary says in words where the branch and its PR stand', async () => {
  expect(summaryLine(OPEN_PR, GIT, true)).toBe('PR #128 · CI ok · 4 commits ahead · 3 behind main · 2 uncommitted')
})

test('a far behind base asks for a rebase', async () => {
  expect(summaryLine(null, { ...GIT, behind: 41, dirty: 0 }, true)).toBe('4 commits ahead · 41 behind main (rebase soon)')
})

test('a session on main with nothing pending says so, and an unreported one too', async () => {
  expect(summaryLine(null, { base: null, ahead: 0, behind: 0, dirty: 0, files: [] }, false)).toBe('no changes · no report')
})

test('a front with an open PR and no session on it waits for the user', async () => {
  const idle = { ...front(null), section: 'paused' as const, sessions: front(null).sessions.map(one => ({ ...one, live: null })) }
  const view = toView([idle], NOW, { pr: { [idle.id]: OPEN_PR } })
  expect(view.waiting[0]?.tag).toBe('PR')
  expect(view.waiting[0]?.detail).toBe('→ PR #128 open, CI ok: needs your review or merge')
  expect(view.paused.length).toBe(0)
})

test('a row says how long ago in words', async () => {
  expect(frontLine(front(null), NOW).age).toBe('1m ago')
  expect(frontLine({ ...front(null), lastActivity: NOW - 5_000 }, NOW).age).toBe('now')
})

test('the summary names the branch first when the front is named by its topic', async () => {
  expect(summaryLine(null, { ...GIT, dirty: 0 }, true, 'feat/search')).toBe('branch feat/search · 4 commits ahead · 3 behind main')
})

const inRepo = (id: string, repoRoot: string, cwd = repoRoot): Front => {
  const base = front(null)
  const [one] = base.sessions
  const sessions = one ? [{ ...one, report: { ...one.report, cwd, repoRoot } }] : []
  return { ...base, id, repoRoot, sessions }
}

test('one repository needs no group', async () => {
  const view = toView([inRepo('/a#x', '/a'), inRepo('/a#y', '/a', '/a/.worktrees/y')], NOW)
  expect(view.running.map(row => row.group)).toEqual([null, null])
})

test('a worktree is grouped under its main repository', async () => {
  const view = toView([inRepo('/w/app#x', '/w/app', '/w/app/.worktrees/x'), inRepo('/w/blog#y', '/w/blog'), inRepo('/w/app#z', '/w/app')], NOW)
  expect(view.running.map(row => [row.id, row.group?.label])).toEqual([
    ['/w/app#x', 'app'],
    ['/w/app#z', 'app'],
    ['/w/blog#y', 'blog'],
  ])
})

test('two repositories with the same folder name are told apart by the folder above', async () => {
  const groups = repoGroups([inRepo('/w/one/app#x', '/w/one/app'), inRepo('/w/two/app#y', '/w/two/app')])
  const labels = [...groups.values()].map(group => group.label)
  expect(labels).toEqual(['one/app', 'two/app'])
  expect(new Set([...groups.values()].map(group => group.color)).size).toBe(2)
})
