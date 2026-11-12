import { expect, mock, test, type TestBody } from 'claude-code/testing'

import { parseReport, serializeReport, type Report } from '../src/report'
import { PERMISSION_GRACE_MS, summarizeInput } from '../src/reporter'

const DIR = '/h/.claude/pitwall/reports'

type TestOn = Parameters<TestBody>[1]
// `ask`: every call stays under way askMs (the classifier or the person
// deciding), then runs runMs. The test raises the ask while it is under way.
type Options = { clock?: boolean; ask?: { askMs: number; runMs?: number }; failWrites?: boolean; ids?: string[]; branches?: string[]; existing?: Report }

// Stands for the engine beneath the reporter and keeps every report it writes.
function engine(on: TestOn, options: Options = {}) {
  const reports: Report[] = []
  const clock = options.clock ? mock.clock(on, { now: 1_000_000 }) : null
  const ids = [...(options.ids ?? ['s1'])]
  const branches = [...(options.branches ?? ['feat/x'])]
  on('env.get', (_, e) => ({ value: e.name === 'HOME' ? '/h' : undefined }))
  on('session.id', () => ({ value: ids.length > 1 ? ids.shift() ?? 's1' : ids[0] ?? 's1' }))
  on('session.cwd', () => ({ value: '/repo' }))
  on('session.repo', () => ({ value: { root: '/repo', remote: null, internal: false, name: null } }))
  on('process.run', (_, e) => {
    if (e.argv[0] === 'tail') {
      const row = JSON.stringify({ type: 'ai-title', aiTitle: 'Bugs de app web #3454' })
      return { value: { exitCode: 0, stdout: `${row}\n`, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    const branch = branches.length > 1 ? branches.shift() : branches[0]
    return { value: { exitCode: 0, stdout: `${branch}\n`, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('fs.read', (_, e) => {
    if (options.existing && e.path === `${DIR}/${options.existing.sessionId}.json`) {
      return { value: serializeReport(options.existing) }
    }
    throw new Error('ENOENT')
  })
  on('fs.write', (_, e) => {
    if (options.failWrites) throw new Error('disk full')
    if (e.path.startsWith(DIR)) {
      const report = parseReport(e.text)
      if (report) reports.push(report)
    }
    return { value: undefined }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  const callIds: string[] = []
  const ask = options.ask
  if (ask && clock) {
    on('tool.call', async (_, e) => {
      callIds.push(e.tool_use_id)
      await clock.sleep(ask.askMs + (ask.runMs ?? 0))
      return { result: {} }
    })
  } else {
    on('tool.call', () => ({ result: {} }))
  }
  // A call that asks inside it gets past the check: its tool hook raises the ask.
  on('tool.check', () => ({ decision: options.ask ? 'allow' : 'ask' }))
  on('classic.PermissionRequest', () => ({}))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  return { last: () => reports[reports.length - 1], reports, clock, callIds }
}

const START = { cwd: '/repo', surface: 'terminal', isInteractive: true } as const
const ASK = { tool_name: 'Bash', tool_input: { command: 'git push origin feat/x' } }

test('a started session reports running on its branch', async ($, on) => {
  const seen = engine(on)
  await $.session.start(START)

  expect(seen.last()?.state).toBe('running')
  expect(seen.last()?.branch).toBe('feat/x')
  expect(seen.last()?.repoRoot).toBe('/repo')
})

test('a non interactive session writes no report', async ($, on) => {
  const seen = engine(on)
  await $.session.start({ ...START, isInteractive: false })
  await $.turn.start({ text: 'hola', turnId: 't1' })

  expect(seen.reports.length).toBe(0)
})

test('a permission dialog reports a manual wait', async ($, on) => {
  const seen = engine(on, { clock: true })
  await $.session.start(START)
  await $.classic.PermissionRequest(ASK)
  await seen.clock?.advance(PERMISSION_GRACE_MS)

  expect(seen.last()?.state).toBe('waiting')
  expect(seen.last()?.waiting?.kind).toBe('manual')
  expect(seen.last()?.waiting?.classified).toBe(true)
  expect(seen.last()?.waiting?.why.startsWith('Permission: Bash')).toBe(true)
})

test('a tool check nobody will be asked about marks no wait', async ($, on) => {
  const seen = engine(on)
  await $.session.start(START)
  await $.tool.check({ tool: 'Bash', input: { command: 'ls' } })

  expect(seen.last()?.state).toBe('running')
})

test('a tool check a person will answer marks a manual wait', async ($, on) => {
  const seen = engine(on, { clock: true })
  await $.session.start(START)
  await $.tool.check({ tool: 'Bash', input: { command: 'git push' }, tool_use_id: 'tu1', approver: 'person' })
  await seen.clock?.advance(PERMISSION_GRACE_MS)

  expect(seen.last()?.state).toBe('waiting')
  expect(seen.last()?.waiting?.why).toBe('Permission: Bash git push')
})

test('where settings hooks run, a tool check marks no wait: auto mode may allow it', async ($, on) => {
  const seen = engine(on)
  await $.session.start(START)
  await $.tool.call({ tool: 'Bash', command: 'git commit -F msg.txt' })
  await $.tool.check({ tool: 'Bash', input: { command: 'git commit -F msg.txt' }, tool_use_id: 'tu2', approver: 'person' })

  expect(seen.last()?.state).toBe('running')
  expect(seen.last()?.waiting).toBe(null)
})

test('where settings hooks run, a real permission dialog still marks the wait', async ($, on) => {
  const seen = engine(on, { clock: true })
  await $.session.start(START)
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await $.classic.PermissionRequest(ASK)
  await seen.clock?.advance(PERMISSION_GRACE_MS)

  expect(seen.last()?.state).toBe('waiting')
  expect(seen.last()?.waiting?.why.startsWith('Permission: Bash')).toBe(true)
})

test('the title skips pasted images and slash commands', async ($, on) => {
  const seen = engine(on)
  await $.session.start(START)
  await $.turn.start({ text: '[Image #3]\n/panel\nrevisa el toast del desktop', turnId: 't1' })

  expect(seen.last()?.title).toBe('revisa el toast del desktop')
})

test('the tool call that was asked for brings the session back to running', async ($, on) => {
  const seen = engine(on)
  await $.session.start(START)
  await $.classic.PermissionRequest(ASK)
  await $.tool.call({ tool: 'Bash', command: 'ls' })

  expect(seen.last()?.state).toBe('running')
  expect(seen.last()?.waiting).toBe(null)
})

test('a subagent permission does not mark the session as waiting', async ($, on) => {
  const seen = engine(on)
  await $.session.start(START)
  await $.classic.PermissionRequest({ ...ASK, agent_id: 'a1' })

  expect(seen.last()?.state).toBe('running')
})

test('an ended session reports ended', async ($, on) => {
  const seen = engine(on)
  await $.session.start(START)
  await $.session.end({ reason: 'prompt_input_exit', sessionId: 's1', resume: { id: 's1' } })

  expect(seen.last()?.state).toBe('ended')
})

test('after /clear the next turn reports under the new session id', async ($, on) => {
  const seen = engine(on, { ids: ['s1', 's2'] })
  await $.session.start(START)
  await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
  await $.turn.start({ text: 'nuevo tema', turnId: 't2' })

  expect(seen.last()?.sessionId).toBe('s2')
  expect(seen.reports.filter(one => one.sessionId === 's1').at(-1)?.state).toBe('ended')
})

test('a branch made during the session is picked up at the end of a turn', async ($, on) => {
  const seen = engine(on, { branches: ['main', 'feat/y'] })
  await $.session.start(START)
  await $.turn.start({ text: 'crea la rama', turnId: 't1' })
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })

  expect(seen.last()?.branch).toBe('feat/y')
})

test('a reload keeps what the session had reported', async ($, on) => {
  const existing: Report = {
    v: 1,
    sessionId: 's1',
    cwd: '/repo',
    repoRoot: '/repo',
    branch: 'feat/x',
    title: 'Search tools',
    activity: 'Bash: ls',
    state: 'waiting',
    waiting: { kind: 'decision', why: 'w', question: 'q', options: [], recap: '', since: 1, classified: true },
    updatedAt: 1,
    lastMessage: 'Shall I start the dev server?',
    steps: ['Bash: ls'],
  }
  const seen = engine(on, { existing })
  await $.session.start(START)

  expect(seen.last()?.state).toBe('waiting')
  expect(seen.last()?.title).toBe('Search tools')
  expect(seen.last()?.waiting?.why).toBe('w')
  expect(seen.last()?.lastMessage).toBe('Shall I start the dev server?')
  expect(seen.last()?.steps).toEqual(['Bash: ls'])
})

test('a turn the user interrupted leaves the session idle', async ($, on) => {
  const seen = engine(on)
  await $.session.start(START)
  await $.turn.complete({ answer: 'a medias', durationMs: 1, isAborted: true, turnId: 't1', reason: 'aborted' })

  expect(seen.last()?.state).toBe('idle')
})

test('a failing disk never breaks the tool call', async ($, on) => {
  engine(on, { failWrites: true })
  await $.session.start(START)
  const ran = await $.tool.call({ tool: 'Bash', command: 'ls' })

  expect(ran).toBeDefined()
})

test('a bash input is summarized by its command, cut to 60 characters', async () => {
  expect(summarizeInput('Bash', { command: 'git push origin feat/x' })).toBe('git push origin feat/x')
  expect(summarizeInput('Bash', { command: 'x'.repeat(80) }).length).toBe(60)
  expect(summarizeInput('Edit', { file_path: '/repo/src/a.ts' })).toBe('/repo/src/a.ts')
})

test('the end of a turn keeps the last message for the panel, cut to 40 lines', async ($, on) => {
  const seen = engine(on)
  await $.session.start(START)
  const answer = Array.from({ length: 50 }, (_, index) => `line ${index + 1}`).join('\n')
  await $.turn.complete({ answer, durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })

  const kept = seen.last()?.lastMessage ?? ''
  expect(kept.split('\n').length).toBe(41)
  expect(kept.startsWith('line 1\n')).toBe(true)
  expect(kept.endsWith('…')).toBe(true)
})

test('the last five steps are kept, newest last', async ($, on) => {
  const seen = engine(on)
  await $.session.start(START)
  for (const command of ['a', 'b', 'c', 'd', 'e', 'f']) await $.tool.call({ tool: 'Bash', command })
  await $.turn.complete({ answer: 'listo', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })

  expect(seen.last()?.steps).toEqual(['Bash: b', 'Bash: c', 'Bash: d', 'Bash: e', 'Bash: f'])
})

test('the end of a turn picks up the title Claude gave the conversation', async ($, on) => {
  const seen = engine(on)
  await $.session.start(START)
  await $.turn.complete({ answer: 'listo', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })

  expect(seen.last()?.aiTitle).toBe('Bugs de app web #3454')
})

test('a question dialog says what it asks', async ($, on) => {
  const seen = engine(on)
  await $.session.start(START)
  await $.classic.PermissionRequest({ tool_name: 'AskUserQuestion', tool_input: { questions: [{ question: 'Which cache?' }] } })

  expect(seen.last()?.waiting?.why).toBe('Permission: AskUserQuestion Which cache?')
})

test('a tool with nothing to show is named once', async ($, on) => {
  const seen = engine(on, { clock: true })
  await $.session.start(START)
  await $.classic.PermissionRequest({ tool_name: 'TodoWrite', tool_input: {} })
  await seen.clock?.advance(PERMISSION_GRACE_MS)

  expect(seen.last()?.waiting?.why).toBe('Permission: TodoWrite')
})

test('auto mode answering within the grace period shows no wait', async ($, on) => {
  const seen = engine(on, { clock: true, ask: { askMs: 3_000 } })
  const clock = seen.clock!
  await $.session.start(START)
  const call = $.tool.call({ tool: 'Bash', command: 'curl https://example.com' })
  await clock.settle()
  await $.classic.PermissionRequest(ASK)
  await clock.advance(3_000)
  await call
  await clock.advance(PERMISSION_GRACE_MS * 2)

  expect(seen.reports.some(one => one.state === 'waiting')).toBe(false)
})

test('a dialog still open after the grace period shows the wait, and clears when the call runs', async ($, on) => {
  const seen = engine(on, { clock: true, ask: { askMs: 30_000 } })
  const clock = seen.clock!
  await $.session.start(START)
  const call = $.tool.call({ tool: 'Bash', command: 'git push' })
  await clock.settle()
  await $.classic.PermissionRequest(ASK)
  await clock.advance(PERMISSION_GRACE_MS - 1_000)
  expect(seen.last()?.state).toBe('running')
  await clock.advance(2_000)
  expect(seen.last()?.state).toBe('waiting')
  expect(seen.last()?.waiting?.why.startsWith('Permission: Bash')).toBe(true)
  await clock.advance(30_000)
  await call
  expect(seen.last()?.state).toBe('running')
})

test('a command the engine draws as executing is not waiting, however long it runs', async ($, on) => {
  const seen = engine(on, { clock: true, ask: { askMs: 1_000, runMs: 60_000 } })
  const clock = seen.clock!
  await $.session.start(START)
  const call = $.tool.call({ tool: 'Bash', command: 'git commit -F msg.txt' })
  await clock.settle()
  await $.classic.PermissionRequest(ASK)
  await clock.advance(2_000)
  const id = seen.callIds[0] ?? ''
  await $.ui.mount({ plugin: 'pitwall', surface: 'terminal', component: 'ToolProgress', requestId: id, props: { tool_use_id: id, kind: 'background_hint', hint: '(ctrl+b to run in background)' } })
  await clock.advance(PERMISSION_GRACE_MS * 3)
  expect(seen.reports.some(one => one.state === 'waiting')).toBe(false)
  await clock.advance(60_000)
  await call
})

test('the title skips a pasted block and takes the words around it', async ($, on) => {
  const seen = engine(on)
  await $.session.start(START)
  await $.turn.start({ text: '<pasted_content id="ad6e">\nERROR deadlock on orders\n</pasted_content>\nmirá este log', turnId: 't1' })

  expect(seen.last()?.title).toBe('mirá este log')
})

test('a title saved from a bare paste tag gives way to the next prompt', async ($, on) => {
  const existing: Report = {
    v: 1,
    sessionId: 's1',
    cwd: '/repo',
    repoRoot: '/repo',
    branch: 'feat/x',
    title: '<pasted_content id="ad6e">',
    activity: null,
    state: 'idle',
    waiting: null,
    updatedAt: 1,
  }
  const seen = engine(on, { existing })
  await $.session.start(START)
  await $.turn.start({ text: 'mirá este log', turnId: 't1' })

  expect(seen.last()?.title).toBe('mirá este log')
})

test('a prompt that is only a paste leaves the title for later', async ($, on) => {
  const seen = engine(on)
  await $.session.start(START)
  await $.turn.start({ text: '<pasted_content id="ad6e">\nERROR deadlock on orders\n</pasted_content>', turnId: 't1' })

  expect(seen.last()?.title).toBe(null)
})
