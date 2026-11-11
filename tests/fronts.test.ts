import { expect, test } from 'claude-code/testing'

import { buildFronts, frontId, PAUSE_WINDOW_MS, type FrontOverrides } from '../src/fronts'
import type { LiveSession } from '../src/registry'
import type { Report, Waiting } from '../src/report'

const NOW = 10 * PAUSE_WINDOW_MS
const NONE: FrontOverrides = { aliases: {}, names: {}, dismissed: {} }

function report(id: string, patch: Partial<Report> = {}): Report {
  return {
    v: 1,
    sessionId: id,
    cwd: '/repo',
    repoRoot: '/repo',
    branch: 'feat/x',
    title: `title ${id}`,
    activity: null,
    state: 'running',
    waiting: null,
    updatedAt: NOW - 1_000,
    ...patch,
  }
}

function live(id: string): LiveSession {
  return { sessionId: id, name: `name-${id}`, pid: 1, status: 'busy', cwd: '/repo', updatedAt: NOW - 1_000 }
}

function wait(since: number, kind: Waiting['kind'] = 'decision'): Waiting {
  return { kind, why: 'why', question: 'q', options: [], recap: '', since, classified: true }
}

const build = (reports: Report[], lives: LiveSession[], overrides = NONE) =>
  buildFronts({ reports, inferred: [], live: lives, overrides, now: NOW })

test('a front is keyed by repo and branch', async () => {
  expect(frontId(report('a'))).toBe('/repo#feat/x')
})

test('a session outside git is a front of its own', async () => {
  expect(frontId(report('a', { repoRoot: null, branch: null }))).toBe('/repo#session:a')
})

test('a session on the default branch is a front of its own', async () => {
  expect(frontId(report('a', { branch: 'main' }))).toBe('/repo#session:a')
})

test('a waiting report with no live session is paused, not waiting', async () => {
  const fronts = build([report('a', { state: 'waiting', waiting: wait(NOW - 5_000) })], [])
  expect(fronts.map(front => front.section)).toEqual(['paused'])
})

test('two live sessions on one branch, one waiting, make one waiting front', async () => {
  const fronts = build(
    [report('a', { state: 'waiting', waiting: wait(NOW - 5_000) }), report('b')],
    [live('a'), live('b')],
  )
  expect(fronts.length).toBe(1)
  expect(fronts[0]?.section).toBe('waiting')
  expect(fronts[0]?.sessions.length).toBe(2)
})

test('waiting fronts come oldest wait first', async () => {
  const fronts = build(
    [
      report('a', { branch: 'a', state: 'waiting', waiting: wait(NOW - 1_000) }),
      report('b', { branch: 'b', state: 'waiting', waiting: wait(NOW - 9_000) }),
    ],
    [live('a'), live('b')],
  )
  expect(fronts.map(front => front.name)).toEqual(['b', 'a'])
})

test('an alias joins two fronts', async () => {
  const fronts = build([report('a', { branch: 'a' }), report('b', { branch: 'b' })], [live('a'), live('b')], {
    ...NONE,
    aliases: { '/repo#a': '/repo#b' },
  })
  expect(fronts.length).toBe(1)
  expect(fronts[0]?.sessions.length).toBe(2)
})

test('an alias cycle does not hang', async () => {
  const fronts = build([report('a', { branch: 'a' })], [live('a')], {
    ...NONE,
    aliases: { '/repo#a': '/repo#b', '/repo#b': '/repo#a' },
  })
  expect(fronts.length).toBe(1)
})

test('a renamed front shows its new name', async () => {
  const fronts = build([report('a')], [live('a')], { ...NONE, names: { '/repo#feat/x': 'Search cache' } })
  expect(fronts[0]?.name).toBe('Search cache')
})

test('a dismissed paused front stays hidden until it moves again', async () => {
  const dismissed = { ...NONE, dismissed: { '/repo#feat/x': NOW - 500 } }
  expect(build([report('a')], [], dismissed).length).toBe(0)
  expect(build([report('a', { updatedAt: NOW - 100 })], [], dismissed).length).toBe(1)
})

test('a front quiet for more than seven days is gone', async () => {
  expect(build([report('a', { updatedAt: NOW - PAUSE_WINDOW_MS - 1 })], []).length).toBe(0)
})

test('a live session that finished its turn and asks nothing is idle', async () => {
  const fronts = build([report('a', { state: 'idle' })], [live('a')])
  expect(fronts[0]?.section).toBe('idle')
})

test('a front with one session working and one idle is running', async () => {
  const fronts = build([report('a', { state: 'idle' }), report('b', { state: 'running' })], [live('a'), live('b')])
  expect(fronts.map(front => front.section)).toEqual(['running'])
})

test('idle sorts after running and before paused', async () => {
  const fronts = build(
    [
      report('p', { state: 'idle', branch: 'feat/p' }),
      report('i', { state: 'idle', branch: 'feat/i' }),
      report('r', { state: 'running', branch: 'feat/r' }),
    ],
    [live('i'), live('r')],
  )
  expect(fronts.map(front => front.section)).toEqual(['running', 'idle', 'paused'])
})

test('a front marks whether any of its sessions reports for itself', async () => {
  const fronts = build([report('a')], [live('a')])
  expect(fronts[0]?.sessions[0]?.reported).toBe(true)
})

test('a session known only from its transcript is marked unreported', async () => {
  const fronts = buildFronts({ reports: [], inferred: [report('a')], live: [live('a')], overrides: NONE, now: NOW })
  expect(fronts[0]?.sessions[0]?.reported).toBe(false)
})

test('a session on a shared branch is named by its title', async () => {
  const fronts = build([report('a', { branch: 'main', title: 'Docs refresh' })], [live('a')])
  expect(fronts[0]?.name).toBe('Docs refresh')
})

test('an ended session on main with nothing to recognize it by is not shown', async () => {
  expect(build([report('a', { branch: 'main', title: null, activity: null, state: 'ended' })], []).length).toBe(0)
})

test('a session on main without a title is named after its session', async () => {
  const fronts = build([report('a', { branch: 'main', title: null })], [live('a')])
  expect(fronts[0]?.name).toBe('name-a')
})

test('a detached HEAD is no branch: the session is a front of its own', async () => {
  expect(frontId(report('a', { branch: 'HEAD' }))).toBe('/repo#session:a')
  const fronts = build([report('a', { branch: 'HEAD', title: null })], [live('a')])
  expect(fronts[0]?.name).toBe('name-a')
})

test('a title saved with an image marker or a slash command is cleaned for the name', async () => {
  expect(build([report('a', { branch: 'main', title: '[Image #3]' })], [live('a')])[0]?.name).toBe('name-a')
  expect(build([report('a', { branch: 'main', title: '[Image #2] revisa el toast' })], [live('a')])[0]?.name).toBe('revisa el toast')
})

test('a front is named by what its session works on, before its branch', async () => {
  expect(build([report('a', { topic: 'Tests paralelos locales' })], [live('a')])[0]?.name).toBe('Tests paralelos locales')
})

test('before it has a topic, a front is named like its terminal tab', async () => {
  expect(build([report('a', { aiTitle: 'Bugs de app web #3454' })], [live('a')])[0]?.name).toBe('Bugs de app web #3454')
  expect(build([report('a', { aiTitle: 'Bugs de app web #3454', topic: 'Panel de variables' })], [live('a')])[0]?.name).toBe(
    'Panel de variables',
  )
})

test('a name the user gave the session wins over topic, title and branch', async () => {
  const named = { ...live('a'), name: 'Coordinador', nameSource: 'user' }
  const fronts = build([report('a', { title: 'repasemos que decisiones', topic: 'Panel de sesiones' })], [named])
  expect(fronts[0]?.name).toBe('Coordinador')
})

test('a name this mod gave by renaming is a topic, not a user name', async () => {
  const renamed = { ...live('a'), name: 'Panel de sesiones', nameSource: 'user' }
  const fronts = build([report('a', { topic: 'Panel de sesiones v2', autoName: 'Panel de sesiones' })], [renamed])
  expect(fronts[0]?.name).toBe('Panel de sesiones v2')
})
