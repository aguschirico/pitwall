import { expect, mock, test, type MockClock, type TestBody } from 'claude-code/testing'

import { REFRESH_MS } from '../src/coordinator'
import { PANE_ID } from '../src/pane'
import { serializeReport, type Report } from '../src/report'

type TestOn = Parameters<TestBody>[1]
type Ran = { exitCode: number; stdout: string; stderr: string; isStdoutTruncated: boolean; isStderrTruncated: boolean }

const NOW = 2_000_000_000_000
const HOME = '/h'
const REPORTS = `${HOME}/.claude/pitwall/reports`
const SESSIONS = `${HOME}/.claude/sessions`

const PANE = {
  plugin: 'pitwall',
  component: 'Pane',
  requestId: PANE_ID,
  props: {
    title: 'Sesiones',
    isFocused: false,
    bodyColumns: 100,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

function report(id: string, patch: Partial<Report>): Report {
  return {
    v: 1,
    sessionId: id,
    cwd: `/repo/${id}`,
    repoRoot: '/repo',
    branch: id,
    title: null,
    activity: 'Bash: ls',
    state: 'running',
    waiting: null,
    updatedAt: NOW - 60_000,
    ...patch,
  }
}

const SEARCH = report('search', {
  state: 'waiting',
  waiting: { kind: 'decision', why: 'pick A or B', question: 'Go with A or B?', options: ['A', 'B'], recap: '', since: NOW - 120_000, classified: true },
  lastMessage: 'I tried both options on real data.\nGo with A or B?',
  steps: ['Bash: pnpm test', 'Edit: src/cache.ts'],
})
const DOCS = report('docs', {})
const OLD = report('old', { updatedAt: NOW - 3_600_000 })

const ran = (stdout: string, exitCode = 0): Ran => ({ exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false })

type World = {
  files: Record<string, string>
  gh: Record<string, string>
  lists: { count: number }
  sent: { to: string; text: string }[]
  runs: string[][]
  slowGhMs?: number
  failPs?: boolean
  noCodeCli?: boolean
}

function processAnswer(world: World, argv: readonly string[]): Ran {
  if (argv[0] === 'ps' && argv.includes('tty=')) return ran('ttys001\n')
  if (argv[0] === 'ps') return ran('  1\n  2\n  3\n')
  if (argv[0] === 'osascript') return ran('focused\n')
  if (argv[0] === 'gh') return world.gh[argv[3] ?? ''] !== undefined ? ran(world.gh[argv[3] ?? ''] ?? '') : ran('', 1)
  if (argv[0] === 'git' && argv.includes('symbolic-ref')) return ran('origin/main\n')
  if (argv[0] === 'git' && argv.includes('rev-list')) return ran('3\t4\n')
  if (argv[0] === 'git' && argv.includes('--numstat')) return ran('182\t20\tserver/src/mcp/tools.ts\n')
  if (argv[0] === 'git' && argv.includes('status')) return ran(' M a.ts\n')
  if (argv[0] === 'git' && argv.includes('log')) return ran('34f68cd\tfix(f4): keep code spans out\n')
  if (argv[0] === 'git') return ran('abc\n')
  if (argv[0] === 'code') return world.noCodeCli ? ran('', 127) : ran('')
  if (argv[0] === 'open') return ran('')
  return ran('', 1)
}

function engine(on: TestOn, world: World): MockClock {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  mock.env(on, { HOME })
  on('session.id', () => ({ value: 'coord' }))
  on('session.repo', () => ({ value: null }))
  on('fs.write', (_, e) => {
    world.files[e.path] = e.text
    return { value: undefined }
  })
  on('fs.list', (_, e) => {
    if (e.path === SESSIONS) world.lists.count += 1
    const names = Object.keys(world.files)
      .filter(path => path.startsWith(`${e.path}/`))
      .map(path => ({ name: path.slice(e.path.length + 1), kind: 'file' as const, size: 1, mtimeMs: 1, isLink: false }))
    return { value: names }
  })
  on('fs.read', (_, e) => ({ value: world.files[e.path] ?? '' }))
  on('process.run', async (_, e) => {
    world.runs.push([...e.argv])
    if (e.argv[0] === 'ps' && world.failPs) throw new Error('ps missing')
    if (e.argv[0] === 'gh' && world.slowGhMs) await clock.sleep(world.slowGhMs)
    return { value: processAnswer(world, e.argv) }
  })
  on('command.register', () => ({ value: { command: 'panel' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.register', (_, e) => ({ value: { tool: `mcp__pitwall__${e.name}` } }))
  on('session.send', (_, e) => {
    world.sent.push({ to: e.to, text: e.text })
    return { isDelivered: true }
  })
  return clock
}

const live = (pid: number, id: string) => JSON.stringify({ pid, sessionId: id, cwd: `/repo/${id}`, name: `s-${id}`, status: 'idle', updatedAt: NOW })

function world(): World {
  return {
    files: {
      [`${REPORTS}/search.json`]: serializeReport(SEARCH),
      [`${REPORTS}/docs.json`]: serializeReport(DOCS),
      [`${REPORTS}/old.json`]: serializeReport(OLD),
      [`${SESSIONS}/1.json`]: live(1, 'search'),
      [`${SESSIONS}/2.json`]: live(2, 'docs'),
    },
    gh: { docs: JSON.stringify({ number: 117, state: 'OPEN', reviewDecision: null, statusCheckRollup: [] }) },
    lists: { count: 0 },
    sent: [],
    runs: [],
  }
}

const PANEL_COMMAND = {
  command: 'panel',
  args: '',
  origin: { kind: 'composer' },
  presentation: { isFullscreen: false, columns: 100 },
} as const

async function openPanel($: Parameters<TestBody>[0]) {
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.command.run(PANEL_COMMAND)
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`/panel draws the three sections on ${surface}`, async ($, on) => {
    const clock = engine(on, world())
    await openPanel($)
    await clock.settle()
    const ui = await $.ui.mount({ ...PANE, surface })

    expect((await ui.find({ type: 'Text', text: /Waiting on you · 1/ }))?.text).toBe('Waiting on you · 1')
    expect(await ui.find({ type: 'Text', text: /Running · 1/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Paused · 1/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /#117/ })).toBeDefined()
    await ui.unmount()
  })

  test(`opening a waiting front shows its question on ${surface}`, async ($, on) => {
    const clock = engine(on, world())
    await openPanel($)
    await clock.settle()
    const ui = await $.ui.mount({ ...PANE, surface })

    expect(await ui.find({ type: 'Text', text: /Go with A/ })).toBe(undefined)
    await ui.press({ key: '/repo#search' })
    expect(await ui.find({ type: 'Text', text: /Go with A/ })).toBeDefined()
    await ui.press({ key: '/repo#search' })
    expect(await ui.find({ type: 'Text', text: /Go with A/ })).toBe(undefined)
    await ui.unmount()
  })
}

test('running /panel twice keeps one refresh per period', async ($, on) => {
  const seen = world()
  const clock = engine(on, seen)
  await openPanel($)
  await $.command.run(PANEL_COMMAND)
  await clock.settle()
  const before = seen.lists.count
  await clock.advance(REFRESH_MS)

  expect(seen.lists.count - before).toBe(1)
})

test('a paused front whose pr merged leaves the panel', async ($, on) => {
  const seen = world()
  seen.gh.old = JSON.stringify({ number: 9, state: 'MERGED', reviewDecision: null, statusCheckRollup: [] })
  const clock = engine(on, seen)
  await openPanel($)
  await clock.settle()
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  expect(await ui.find({ type: 'Text', text: /Paused · 0/ })).toBeDefined()
  await ui.unmount()
})

const TOOL = 'mcp__pitwall__'

test('a decision goes to the waiting session as the user\'s words', async ($, on) => {
  const seen = world()
  const clock = engine(on, seen)
  await openPanel($)
  await clock.settle()
  const done = await $.tool.call({ tool: `${TOOL}send_to_front`, frontId: '/repo#search', text: 'pick B' })

  expect(seen.sent).toEqual([{ to: 'search', text: 'Relayed from the coordinator by the user: "pick B"' }])
  expect(String(done.result)).toBe('Sent to search.')
})

test('an approval is not sent and names the session to go to', async ($, on) => {
  const seen = world()
  const clock = engine(on, seen)
  await openPanel($)
  await clock.settle()
  const done = await $.tool.call({ tool: `${TOOL}send_to_front`, frontId: '/repo#search', text: 'push it' })

  expect(seen.sent).toEqual([])
  expect(String(done.result).startsWith('Not sent')).toBe(true)
})

test('merging two fronts joins them on the next refresh', async ($, on) => {
  const clock = engine(on, world())
  await openPanel($)
  await clock.settle()
  await $.tool.call({ tool: `${TOOL}merge_fronts`, fromId: '/repo#docs', intoId: '/repo#search' })
  await clock.settle()
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  expect(await ui.find({ type: 'Text', text: /Running · 0/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Waiting on you · 1/ })).toBeDefined()
  await ui.unmount()
})

test('a renamed front shows its new name', async ($, on) => {
  const clock = engine(on, world())
  await openPanel($)
  await clock.settle()
  await $.tool.call({ tool: `${TOOL}rename_front`, frontId: '/repo#docs', name: 'Docs refresh' })
  await clock.settle()
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  expect(await ui.find({ type: 'Button', text: /Docs refresh/ })).toBeDefined()
  await ui.unmount()
})

test('the fronts are listed for the model with their ids', async ($, on) => {
  const clock = engine(on, world())
  await openPanel($)
  await clock.settle()
  const done = await $.tool.call({ tool: `${TOOL}list_fronts` })

  expect(String(done.result).includes('/repo#search')).toBe(true)
  expect(String(done.result).includes('Decision')).toBe(true)
})

test('a message that goes around the tool is still held to the approval rule', async ($, on) => {
  const seen = world()
  const clock = engine(on, seen)
  await openPanel($)
  await clock.settle()
  const byId = await $.session.send({ to: 'search', text: 'push it', origin: { kind: 'model' } })
  const byName = await $.session.send({ to: 's-search', text: 'deploy it', origin: { kind: 'model' } })

  expect(byId.isDelivered).toBe(false)
  expect(byName.isDelivered).toBe(false)
  expect(seen.sent).toEqual([])
})

test('a message to a session that is no front goes through', async ($, on) => {
  const seen = world()
  const clock = engine(on, seen)
  await openPanel($)
  await clock.settle()
  const sent = await $.session.send({ to: 'other-session', text: 'push it', origin: { kind: 'model' } })

  expect(sent.isDelivered).toBe(true)
})

test('a name two fronts share is not guessed', async ($, on) => {
  const seen = world()
  const clock = engine(on, seen)
  await openPanel($)
  await clock.settle()
  await $.tool.call({ tool: `${TOOL}rename_front`, frontId: '/repo#docs', name: 'search' })
  await clock.settle()
  const done = await $.tool.call({ tool: `${TOOL}send_to_front`, frontId: 'search', text: 'pick B' })

  expect(seen.sent).toEqual([])
  expect(String(done.result).startsWith('More than one front')).toBe(true)
})

test('reports older than the pause window with no session are deleted', async ($, on) => {
  const seen = world()
  seen.files[`${REPORTS}/gone.json`] = serializeReport(report('gone', { updatedAt: NOW - 8 * 86_400_000 }))
  const clock = engine(on, seen)
  await openPanel($)
  await clock.settle()

  expect(seen.runs).toContainEqual(['rm', '-f', `${REPORTS}/gone.json`])
  expect(seen.runs.some(argv => argv.includes(`${REPORTS}/search.json`) && argv[0] === 'rm')).toBe(false)
})

test('a refresh that fails leaves /panel working', async ($, on) => {
  const seen = world()
  seen.failPs = true
  const clock = engine(on, seen)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const done = await $.command.run(PANEL_COMMAND)
  await clock.advance(REFRESH_MS)

  expect(done.text?.startsWith('Panel open')).toBe(true)
})

test('a refresh still running skips the next tick', async ($, on) => {
  const seen = world()
  seen.slowGhMs = 20_000
  const clock = engine(on, seen)
  await openPanel($)
  await clock.settle()
  await clock.advance(REFRESH_MS)

  expect(seen.lists.count).toBe(1)
})

test('a rename made during a slow refresh survives it', async ($, on) => {
  const seen = world()
  seen.gh.old = JSON.stringify({ number: 9, state: 'MERGED', reviewDecision: null, statusCheckRollup: [] })
  seen.slowGhMs = 20_000
  const clock = engine(on, seen)
  await openPanel($)
  await clock.advance(25_000)
  await clock.advance(1_000)
  const rename = $.tool.call({ tool: `${TOOL}rename_front`, frontId: '/repo#docs', name: 'Docs refresh' })
  await clock.advance(25_000)
  await rename
  await clock.advance(REFRESH_MS + 25_000)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  expect(await ui.find({ type: 'Button', text: /Docs refresh/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Paused · 0/ })).toBeDefined()
  await ui.unmount()
})

test('each front shows where its branch stands against main', async ($, on) => {
  const clock = engine(on, world())
  await openPanel($)
  await clock.settle()
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  expect(await ui.find({ type: 'Text', text: /4 commits ahead · 3 behind main · 1 uncommitted/ })).toBeDefined()
  await ui.unmount()
})

test('opening a front that is not waiting lists the files its branch changed', async ($, on) => {
  const clock = engine(on, world())
  await openPanel($)
  await clock.settle()
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  expect(await ui.find({ type: 'Text', text: /server\/src\/mcp\/tools\.ts/ })).toBe(undefined)
  await ui.press({ key: '/repo#docs' })
  await ui.press({ key: 'git:/repo#docs' })
  expect(await ui.find({ type: 'Text', text: /server\/src\/mcp\/tools\.ts/ })).toBeDefined()
  await ui.unmount()
})

test('Open in VS Code opens the front folder', async ($, on) => {
  const seen = world()
  const clock = engine(on, seen)
  await openPanel($)
  await clock.settle()
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: '/repo#docs' })
  await ui.press({ key: 'open:/repo#docs' })
  await clock.settle()

  expect(seen.runs).toContainEqual(['code', '/repo/docs'])
  await ui.unmount()
})

test('without the code command the folder opens in the VS Code app', async ($, on) => {
  const seen = world()
  seen.noCodeCli = true
  const clock = engine(on, seen)
  await openPanel($)
  await clock.settle()
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: '/repo#docs' })
  await ui.press({ key: 'open:/repo#docs' })
  await clock.settle()

  expect(seen.runs).toContainEqual(['open', '-a', 'Visual Studio Code', '/repo/docs'])
  await ui.unmount()
})

const SNAPSHOT = `${HOME}/.claude/pitwall/snapshot.json`

function snapshotAt(at: number): string {
  return JSON.stringify({
    v: 1,
    at,
    by: 'other-panel',
    reports: [SEARCH, DOCS],
    inferred: [],
    live: [
      { sessionId: 'search', name: 's-search', pid: 1, status: 'idle', cwd: '/repo/search', updatedAt: NOW },
      { sessionId: 'docs', name: 's-docs', pid: 2, status: 'busy', cwd: '/repo/docs', updatedAt: NOW },
    ],
    pr: {},
    git: { '/repo#docs': { base: 'origin/main', ahead: 9, behind: 0, dirty: 0, files: [] } },
  })
}

test('a fresh snapshot another panel wrote is drawn without running git or gh', async ($, on) => {
  const seen = world()
  seen.files[SNAPSHOT] = snapshotAt(NOW - 1_000)
  const clock = engine(on, seen)
  await openPanel($)
  await clock.settle()
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  // The only git call left is this session's own reporter reading its branch at start.
  const panelWork = (argv: string[]) => ['gh', 'ps', 'tail'].includes(argv[0] ?? '') || (argv[0] === 'git' && !argv.includes('--show-current'))
  expect(seen.runs.filter(panelWork)).toEqual([])
  expect(await ui.find({ type: 'Text', text: /Waiting on you · 1/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /9 commits ahead/ })).toBeDefined()
  await ui.unmount()
})

test('a stale snapshot is computed again and written for the other panels', async ($, on) => {
  const seen = world()
  seen.files[SNAPSHOT] = snapshotAt(NOW - 60_000)
  const clock = engine(on, seen)
  await openPanel($)
  await clock.settle()

  expect(seen.runs.some(argv => argv[0] === 'ps')).toBe(true)
  expect(JSON.parse(seen.files[SNAPSHOT] ?? '{}').at).toBe(NOW)
})

test('a panel leaves its own session out, though the snapshot keeps it for the others', async ($, on) => {
  const seen = world()
  seen.files[`${REPORTS}/coord.json`] = serializeReport(report('coord', { branch: 'coordbranch' }))
  seen.files[`${SESSIONS}/3.json`] = live(3, 'coord')
  const clock = engine(on, seen)
  await openPanel($)
  await clock.settle()
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  expect(await ui.find({ type: 'Button', text: /coordbranch/ })).toBe(undefined)
  expect(JSON.parse(seen.files[SNAPSHOT] ?? '{}').reports.some((one: Report) => one.sessionId === 'coord')).toBe(true)
  await ui.unmount()
})

test('opening a waiting front shows what the session last said and its last steps', async ($, on) => {
  const clock = engine(on, world())
  await openPanel($)
  await clock.settle()
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: '/repo#search' })

  expect(await ui.find({ type: 'Text', text: /I tried both options on real data/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Edit: src\/cache\.ts/ })).toBeDefined()
  await ui.unmount()
})

test('Show git opens the branch below with its commits, and closes again', async ($, on) => {
  const clock = engine(on, world())
  await openPanel($)
  await clock.settle()
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: '/repo#search' })
  await ui.press({ key: 'git:/repo#search' })

  expect(await ui.find({ type: 'Text', text: /Git · search/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /34f68cd fix\(f4\): keep code spans out/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /a\.ts/ })).toBeDefined()
  await ui.press({ key: 'git-close' })
  expect(await ui.find({ type: 'Text', text: /Git · search/ })).toBe(undefined)
  await ui.unmount()
})

test('row titles and actions draw without brackets or hotkeys, git in a frame', async ($, on) => {
  const clock = engine(on, world())
  await openPanel($)
  await clock.settle()
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: '/repo#docs' })
  await ui.press({ key: 'git:/repo#docs' })

  expect((await ui.find({ type: 'Button', key: '/repo#docs' }))?.props.plain).toBe(true)
  for (const key of ['git:/repo#docs', 'open:/repo#docs', 'git-close']) {
    const button = await ui.find({ type: 'Button', key })
    expect(button?.props.plain, key).toBe(true)
    expect(button?.props.hotkey, key).toBe(undefined)
  }
  expect((await ui.find({ type: 'Button', key: 'git:/repo#docs' }))?.text).toBe('▸ Hide git')
  expect((await ui.find({ type: 'Button', key: 'open:/repo#docs' }))?.text).toBe('↗ Open in VS Code')
  expect((await ui.find({ type: 'Box', key: 'git-panel' }))?.props.borderStyle).toBe('round')
  await ui.unmount()
})

const coordinate = (args: string) => ({ ...PANEL_COMMAND, command: 'coordinate', args })

test('/coordinate 1 sends the text to the first waiting front', async ($, on) => {
  const seen = world()
  const clock = engine(on, seen)
  await openPanel($)
  await clock.settle()
  const done = await $.command.run(coordinate('1 pick B'))

  expect(seen.sent).toEqual([{ to: 'search', text: 'Relayed from the coordinator by the user: "pick B"' }])
  expect(done.text).toBe('Sent to search.')
})

test('/coordinate still refuses an approval', async ($, on) => {
  const seen = world()
  const clock = engine(on, seen)
  await openPanel($)
  await clock.settle()
  const done = await $.command.run(coordinate('1 push it'))

  expect(seen.sent).toEqual([])
  expect(done.text?.startsWith('Not sent')).toBe(true)
})

test('/coordinate with a number nobody has says so', async ($, on) => {
  const clock = engine(on, world())
  await openPanel($)
  await clock.settle()
  const done = await $.command.run(coordinate('9 hola'))

  expect(done.text).toBe('No session is waiting with number 9. There are 1.')
})

test('/coordinate without text explains how to use it', async ($, on) => {
  const clock = engine(on, world())
  await openPanel($)
  await clock.settle()
  const done = await $.command.run(coordinate('1'))

  expect(done.text).toBe(
    'Usage: /coordinate <number> <text>, or /coordinate <number> go to jump to that session, with the row number in "Waiting on you".',
  )
})

test('waiting rows are numbered in the panel', async ($, on) => {
  const clock = engine(on, world())
  await openPanel($)
  await clock.settle()
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  expect(await ui.find({ type: 'Text', text: /1 · Decision/ })).toBeDefined()
  await ui.unmount()
})

test('/coordinate in a session without the panel asks to open it', async ($, on) => {
  const seen = world()
  engine(on, seen)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const done = await $.command.run(coordinate('1 pick B'))

  expect(done.text).toBe('This session does not have the panel open: run /panel first.')
})

test('/coordinate 1 go brings the waiting session to the front', async ($, on) => {
  const seen = world()
  seen.files[`${REPORTS}/search.json`] = serializeReport({ ...SEARCH, terminal: { program: 'ghostty' } })
  const clock = engine(on, seen)
  await openPanel($)
  await clock.settle()
  const done = await $.command.run(coordinate('1 go'))

  const script = seen.runs.find(argv => argv[0] === 'osascript')?.join(' ') ?? ''
  expect(script.includes('/dev/ttys001')).toBe(true)
  expect(done.text).toBe('Taking you to s-search.')
})

test('a session whose terminal is unknown says where to go instead', async ($, on) => {
  const clock = engine(on, world())
  await openPanel($)
  await clock.settle()
  const done = await $.command.run(coordinate('1 go'))

  expect(done.text).toBe('Cannot bring that terminal forward: the session is "s-search" (repo/search).')
})

test('the row button takes you to the session', async ($, on) => {
  const seen = world()
  seen.files[`${REPORTS}/search.json`] = serializeReport({ ...SEARCH, terminal: { program: 'ghostty' } })
  const clock = engine(on, seen)
  await openPanel($)
  await clock.settle()
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: '/repo#search' })
  expect((await ui.find({ type: 'Button', key: 'go:/repo#search' }))?.text).toBe('↪ Go to session')
  await ui.press({ key: 'go:/repo#search' })
  await clock.settle()

  expect(seen.runs.some(argv => argv[0] === 'osascript')).toBe(true)
  await ui.unmount()
})
