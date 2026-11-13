import { expect, mock, test, type MockClock, type TestBody } from 'claude-code/testing'

import type { OpEventResult } from 'claude-code'

import { buildClassifyPrompt, fallbackClassification, parseClassification, stableTopic } from '../src/classify'
import { parseReport, type Report } from '../src/report'

type TestOn = Parameters<TestBody>[1]

const USAGE = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

const DECISION = '{"kind":"decision","why":"x","question":"A or B?","options":["A","B"],"recap":"r"}'

test('a well formed classification parses', async () => {
  expect(parseClassification(DECISION)).toEqual({
    kind: 'decision',
    why: 'x',
    question: 'A or B?',
    options: ['A', 'B'],
    recap: 'r',
    topic: '',
  })
})

test('a classification wrapped in a code fence parses', async () => {
  expect(parseClassification('```json\n' + DECISION + '\n```')?.kind).toBe('decision')
})

test('text that is not json does not parse', async () => {
  expect(parseClassification('no json')).toBe(null)
})

test('an unknown kind does not parse', async () => {
  expect(parseClassification(DECISION.replace('decision', 'otro'))).toBe(null)
})

test('the fallback is a review titled by the first non empty line', async () => {
  expect(fallbackClassification('\n\nShall I push?\nmore')).toEqual({
    kind: 'review',
    why: 'Shall I push?',
    question: 'Shall I push?',
    options: [],
    recap: '',
    topic: '',
  })
})

test('the prompt carries the message and cuts it to 6000 characters', async () => {
  const prompt = buildClassifyPrompt('y'.repeat(7000))
  expect(prompt.includes('y'.repeat(6000))).toBe(true)
  expect(prompt.includes('y'.repeat(6001))).toBe(false)
})

type ModelAnswer = OpEventResult<'model.complete'>

function engine(on: TestOn, model: (clock: MockClock) => ModelAnswer | Promise<ModelAnswer>) {
  const reports: Report[] = []
  const clock = mock.clock(on)
  on('env.get', (_, e) => ({ value: e.name === 'HOME' ? '/h' : undefined }))
  on('session.id', () => ({ value: 's1' }))
  on('session.repo', () => ({ value: null }))
  on('process.run', () => ({
    value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  on('fs.write', (_, e) => {
    const report = parseReport(e.text)
    if (report) reports.push(report)
    return { value: undefined }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('model.complete', () => model(clock))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  return { last: () => reports[reports.length - 1], clock }
}

const TURN = { answer: 'Option A or B?', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as const

test('a turn that ends with a question reports a decision wait', async ($, on) => {
  const { last, clock } = engine(on, () => ({ value: { isAnswered: true, text: DECISION, usage: USAGE } }))
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  await $.turn.complete(TURN)
  await clock.settle()

  expect(last()?.state).toBe('waiting')
  expect(last()?.waiting?.kind).toBe('decision')
  expect(last()?.waiting?.options).toEqual(['A', 'B'])
})

test('a turn that only reports back leaves the session idle', async ($, on) => {
  const none = '{"kind":"none","why":"","question":"","options":[],"recap":"listo"}'
  const { last, clock } = engine(on, () => ({ value: { isAnswered: true, text: none, usage: USAGE } }))
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  await $.turn.complete(TURN)
  await clock.settle()

  expect(last()?.state).toBe('idle')
})

test('a failing classification still reports the session as waiting for review', async ($, on) => {
  const { last, clock } = engine(on, () => {
    throw new Error('api down')
  })
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  await $.turn.complete(TURN)
  await clock.settle()

  expect(last()?.state).toBe('waiting')
  expect(last()?.waiting?.kind).toBe('review')
  expect(last()?.waiting?.why).toBe('Option A or B?')
})

test('the end of a turn does not wait for the classification', async ($, on) => {
  const { last, clock } = engine(on, async (c: MockClock) => {
    await c.sleep(5_000)
    return { value: { isAnswered: true, text: DECISION, usage: USAGE } }
  })
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  await $.turn.complete(TURN)

  expect(last()?.state).toBe('waiting')
  expect(last()?.waiting?.kind).toBe('review')
})

test('a classification that lands after the next turn started is dropped', async ($, on) => {
  const { last, clock } = engine(on, async (c: MockClock) => {
    await c.sleep(5_000)
    return { value: { isAnswered: true, text: DECISION, usage: USAGE } }
  })
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  await $.turn.complete(TURN)
  await $.turn.start({ text: 'pick A', turnId: 't2' })
  await clock.advance(5_000)

  expect(last()?.state).toBe('running')
})

test('a classification that lands after the session ended is dropped', async ($, on) => {
  const { last, clock } = engine(on, async (c: MockClock) => {
    await c.sleep(5_000)
    return { value: { isAnswered: true, text: DECISION, usage: USAGE } }
  })
  on('session.end', () => ({ sessionId: 's1' }))
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  await $.turn.complete(TURN)
  await $.session.end({ reason: 'prompt_input_exit', sessionId: 's1', resume: { id: 's1' } })
  await clock.advance(5_000)

  expect(last()?.state).toBe('ended')
})

test('the classification carries a short topic of the work', async () => {
  const withTopic = DECISION.replace('"recap":"r"', '"recap":"r","topic":"Search cache"')
  expect(parseClassification(withTopic)?.topic).toBe('Search cache')
  expect(parseClassification(DECISION)?.topic).toBe('')
})

test('the prompt hands the current topic to keep it stable', async () => {
  expect(buildClassifyPrompt('hola', 'Panel de sesiones').includes('Panel de sesiones')).toBe(true)
})

test('the prompt hands what the session was opened for, so the topic names the session and not the step', async () => {
  const prompt = buildClassifyPrompt('Revisé el PR #4002: 3 hallazgos.', 'Pagos', {
    firstPrompt: 'revisá los PRs abiertos del módulo de pagos',
    claudeTitle: 'Payments PR reviews',
    branch: 'main',
  })
  expect(prompt.includes('First thing the user asked: revisá los PRs abiertos del módulo de pagos')).toBe(true)
  expect(prompt.includes('Conversation title: Payments PR reviews')).toBe(true)
  expect(prompt.includes('Git branch: main')).toBe(true)
  expect(prompt.includes('what the whole session is about')).toBe(true)
  expect(prompt.includes('no PR, issue or ticket numbers')).toBe(true)
  expect(prompt.indexOf('Session context:')).toBeLessThan(prompt.indexOf('The message:'))
})

test('no session context leaves the prompt without the block', async () => {
  expect(buildClassifyPrompt('hola').includes('Session context:')).toBe(false)
})

test('a name is not swapped for one that only names a PR or issue of the moment', async () => {
  expect(stableTopic('Revisión de PRs de pagos', 'Revisión PR #4002')).toBe('Revisión de PRs de pagos')
  expect(stableTopic('Hallazgos de auditoría', 'Revisión y hallazgos #563')).toBe('Hallazgos de auditoría')
  expect(stableTopic('Search cache', 'Search cache invalidation')).toBe('Search cache invalidation')
  expect(stableTopic('', 'Revisión PR #4002')).toBe('Revisión PR #4002')
  expect(stableTopic('Revisión PR #4002', 'Revisión de PRs de pagos')).toBe('Revisión de PRs de pagos')
  expect(stableTopic('Search cache', '')).toBe('Search cache')
})

test('a long fallback is cut at the last whole word', async () => {
  const why = fallbackClassification(`${'word '.repeat(30)}tail`).why
  expect(why.length).toBeLessThanOrEqual(120)
  expect(why.endsWith(' word…')).toBe(true)
})

test('the prompt counts an offer of a next step as a decision, and a held push as an OK push', async () => {
  const prompt = buildClassifyPrompt('hola')
  expect(prompt.includes('offers a next step and waits for the user')).toBe(true)
  expect(prompt.includes('stays held until the user OKs')).toBe(true)
  expect(prompt.includes('Waiting on someone else')).toBe(true)
})
