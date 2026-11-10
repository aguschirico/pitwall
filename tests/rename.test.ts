import { expect, mock, test, type TestBody } from 'claude-code/testing'

import type { OpEventResult } from 'claude-code'

import { parseReport, type Report } from '../src/report'

type TestOn = Parameters<TestBody>[1]

const USAGE = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const SESSIONS = '/h/.claude/sessions'

function answer(topic: string): OpEventResult<'model.complete'> {
  const text = JSON.stringify({ kind: 'decision', why: 'w', question: 'A or B?', options: [], recap: '', topic })
  return { value: { isAnswered: true, text, usage: USAGE } }
}

type World = { topics: string[]; registry?: Record<string, unknown> }

function engine(on: TestOn, world: World) {
  const reports: Report[] = []
  const renames: string[] = []
  const clock = mock.clock(on)
  on('env.get', () => ({ value: '/h' }))
  on('session.id', () => ({ value: 's1' }))
  on('session.cwd', () => ({ value: '/repo' }))
  on('session.repo', () => ({ value: null }))
  on('process.run', () => ({
    value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  on('fs.list', (_, e) => ({
    value: e.path === SESSIONS && world.registry ? [{ name: '7.json', kind: 'file', size: 1, mtimeMs: 1, isLink: false }] : [],
  }))
  on('fs.read', (_, e) => {
    if (e.path === `${SESSIONS}/7.json` && world.registry) return { value: JSON.stringify(world.registry) }
    throw new Error('ENOENT')
  })
  on('fs.write', (_, e) => {
    const report = parseReport(e.text)
    if (report) reports.push(report)
    return { value: undefined }
  })
  on('model.complete', () => answer(world.topics.shift() ?? ''))
  on('command.run', (_, e) => {
    renames.push(e.args)
    // What the engine's /rename does to the registry.
    if (world.registry) world.registry = { ...world.registry, name: e.args, nameSource: 'user' }
    return { text: `Session renamed to: ${e.args}` }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  return { last: () => reports[reports.length - 1], renames, clock }
}

const START = { cwd: '/repo', surface: 'terminal', isInteractive: true } as const
const turn = (id: string) => ({ answer: 'A or B?', durationMs: 1, isAborted: false, turnId: id, reason: 'answer' }) as const

test('a new topic renames the session and names its front', async ($, on) => {
  const seen = engine(on, { topics: ['Search cache'] })
  await $.session.start(START)
  await $.turn.complete(turn('t1'))
  await seen.clock.settle()

  expect(seen.renames).toEqual(['Search cache'])
  expect(seen.last()?.topic).toBe('Search cache')
  expect(seen.last()?.autoName).toBe('Search cache')
})

test('the same topic again does not rename twice', async ($, on) => {
  const seen = engine(on, { topics: ['Search cache', 'Search cache'] })
  await $.session.start(START)
  await $.turn.complete(turn('t1'))
  await seen.clock.settle()
  await $.turn.start({ text: 'go on', turnId: 't2' })
  await $.turn.complete(turn('t2'))
  await seen.clock.settle()

  expect(seen.renames).toEqual(['Search cache'])
})

test('a session the user named is never renamed', async ($, on) => {
  const registry = { pid: 7, sessionId: 's1', cwd: '/repo', name: 'My session', nameSource: 'user' }
  const seen = engine(on, { topics: ['Search cache'], registry })
  await $.session.start(START)
  await $.turn.complete(turn('t1'))
  await seen.clock.settle()

  expect(seen.renames).toEqual([])
  expect(seen.last()?.topic).toBe('Search cache')
})

test('a session this mod named before is renamed when the work changes', async ($, on) => {
  const registry = { pid: 7, sessionId: 's1', cwd: '/repo', name: 'api-06', nameSource: 'derived' }
  const seen = engine(on, { topics: ['Search cache', 'Desktop toasts'], registry })
  await $.session.start(START)
  await $.turn.complete(turn('t1'))
  await seen.clock.settle()
  await $.turn.start({ text: 'now the toasts', turnId: 't2' })
  await $.turn.complete(turn('t2'))
  await seen.clock.settle()

  expect(seen.renames).toEqual(['Search cache', 'Desktop toasts'])
})
