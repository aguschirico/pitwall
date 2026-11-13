// The reporter runs in every session and keeps that session's report file
// current. It must never break the session it runs in: every write is
// best effort.
import type { Hook, On } from 'claude-code'

import { PASTE_BLOCK } from './fronts'
import { classifyTurn, fallbackClassification, stableTopic, type Classification } from './classify'
import { isCoordinating } from './coordinator'
import { mayRename, renameSession } from './naming'
import { claudeHomeOf } from './paths'
import { parseTail, transcriptPath } from './registry'
import { cutMessage, parseReport, PERMISSION_PREFIX, reportPath, serializeReport, type Report, type TerminalInfo, type Waiting } from './report'
import { cutAtWord } from './untrusted'

type Engine = Parameters<Hook<'session.start'>>[0]

const ACTIVITY_WRITE_MS = 5_000
const SUMMARY_MAX = 60
const STEPS_KEPT = 5
const TAIL_BYTES = 100_000
const SUMMARY_FIELDS = ['command', 'file_path', 'path', 'pattern', 'url', 'description', 'prompt']

let current: Report | null = null
let claudeHome: string | null = null
let lastWrite = 0
let turnSeq = 0
// Whether classic.PermissionRequest reaches this mod in this session: set the
// first time it does (see tool.check).
let classicHooksRun = false
// A permission wait not shown yet. Auto mode's classifier answers most asks
// in seconds, so a wait shows only once it lasts PERMISSION_GRACE_MS: a real
// dialog is still open by then, a classified call has run or is running.
type PendingPermission = { seq: number; callId: string | null; wait: Waiting }
let pending: PendingPermission | null = null
let permissionSeq = 0
// The main loop's calls under way, the newest last, and the ones the engine
// already draws as executing (a Bash command's "run in background" pill).
const callsUnderWay: string[] = []
const callsExecuting = new Set<string>()
// The last calls that finished: a wait for one of them is over.
const callsFinished: string[] = []
const FINISHED_KEPT = 50
// Tools whose dialog is a question to the person: no classifier answers it.
const PERSON_TOOLS = new Set(['AskUserQuestion', 'ExitPlanMode'])
export const PERMISSION_GRACE_MS = 8_000
// The folder the session started in: its transcript lives under it, whatever the cwd is now.
let startCwd: string | null = null

export function summarizeInput(tool: string, input: unknown): string {
  const text = pickField(input) ?? tool
  return cutAtWord(text.replace(/\s+/g, ' ').trim(), SUMMARY_MAX)
}

function pickField(input: unknown): string | null {
  if (typeof input !== 'object' || input === null) return null
  const question = firstQuestion(input)
  if (question) return question
  for (const key of SUMMARY_FIELDS) {
    const value: unknown = Reflect.get(input, key)
    if (typeof value === 'string' && value.trim() !== '') return value
  }
  return null
}

// The first line that says something: pasted-image markers and slash
// commands are no title.
function firstLine(text: string): string | null {
  const line = text
    .replace(PASTE_BLOCK, '\n')
    .split('\n')
    .map(one => one.replace(/\[Image #\d+\]/g, '').trim())
    .find(one => one !== '' && !one.startsWith('/'))
  return line ? line.slice(0, SUMMARY_MAX) : null
}

export async function saveReport($: Engine, patch: Partial<Report>): Promise<void> {
  if (!current || !claudeHome) return
  current = { ...current, ...patch, updatedAt: Date.now() }
  lastWrite = current.updatedAt
  try {
    await $.fs.write(reportPath(claudeHome, current.sessionId), serializeReport(current))
  } catch {
    // A report that could not be written only goes stale; the session goes on.
  }
}

export function currentReport(): Report | null {
  return current
}

async function currentBranch($: Engine, cwd: string): Promise<string | null> {
  const run = await $.process.run(['git', '-C', cwd, 'branch', '--show-current'])
  const branch = run.stdout.trim()
  return run.exitCode === 0 && branch !== '' ? branch : null
}

async function earlierReport($: Engine, sessionId: string): Promise<Report | null> {
  if (!claudeHome) return null
  try {
    const found = parseReport(await $.fs.read(reportPath(claudeHome, sessionId)))
    return found?.sessionId === sessionId && found.state !== 'ended' ? found : null
  } catch {
    return null
  }
}

// Each variable is read by its literal name: the engine lists what a mod reads.
async function terminalOf($: Engine): Promise<TerminalInfo> {
  const [program, tmux, tmuxPane, kittyWindow, weztermPane] = await Promise.all([
    $.env.get('TERM_PROGRAM'),
    $.env.get('TMUX'),
    $.env.get('TMUX_PANE'),
    $.env.get('KITTY_WINDOW_ID'),
    $.env.get('WEZTERM_PANE'),
  ])
  return {
    program: program || null,
    ...(tmux && tmuxPane && { tmuxPane }),
    ...(kittyWindow && { kittyWindow }),
    ...(weztermPane && { weztermPane }),
  }
}

// Also runs on a reload or a worker respawn: what the session had already
// reported (its title, its wait) is kept, not reset.
export async function startReport($: Engine, cwd: string, sessionId?: string): Promise<void> {
  try {
    claudeHome = await claudeHomeOf($)
    startCwd = startCwd ?? cwd
    const id = sessionId ?? (await $.session.id())
    const repo = await $.session.repo()
    const fresh: Report = {
      v: 1,
      sessionId: id,
      cwd,
      repoRoot: repo?.root ?? null,
      branch: await currentBranch($, cwd),
      title: null,
      activity: null,
      state: 'running',
      waiting: null,
      updatedAt: Date.now(),
      lastMessage: null,
      steps: [],
      terminal: await terminalOf($),
    }
    const before = await earlierReport($, id)
    // Only where the session is, and how to reach its terminal, are read anew:
    // its wait, last message and steps stay, or a reload shows a waiting session as idle.
    const kept = before && {
      title: before.title,
      activity: before.activity,
      state: before.state,
      waiting: before.waiting,
      lastMessage: before.lastMessage ?? null,
      steps: before.steps ?? [],
    }
    current = before ? { ...before, ...fresh, ...kept } : fresh
    await saveReport($, {})
  } catch {
    current = null
  }
}

// A branch or worktree made during the session moves its front with it.
async function followLocation($: Engine): Promise<Partial<Report>> {
  try {
    const cwd = await $.session.cwd()
    const repo = await $.session.repo()
    return { cwd, repoRoot: repo?.root ?? null, branch: await currentBranch($, cwd) }
  } catch {
    return {}
  }
}

// AskUserQuestion's first question: what its dialog asks.
function firstQuestion(input: object): string | null {
  const questions: unknown = Reflect.get(input, 'questions')
  const first: unknown = Array.isArray(questions) ? questions[0] : undefined
  const text: unknown = typeof first === 'object' && first !== null ? Reflect.get(first, 'question') : undefined
  return typeof text === 'string' && text.trim() !== '' ? text : null
}

function permissionWait(tool: string, input: unknown): Waiting {
  const summary = summarizeInput(tool, input)
  const why = summary === tool ? `${PERMISSION_PREFIX}${tool}` : `${PERMISSION_PREFIX}${tool} ${summary}`
  return { kind: 'manual', why, question: why, options: [], recap: '', since: Date.now(), classified: true }
}

// Shows the wait at once for a question to the person, else after the grace
// period, if the same call has not run, nor started executing, by then.
async function markPermission($: Engine, tool: string, input: unknown, callId: string | null): Promise<void> {
  const wait = permissionWait(tool, input)
  if (PERSON_TOOLS.has(tool)) {
    pending = null
    await saveReport($, { state: 'waiting', waiting: wait })
    return
  }
  permissionSeq += 1
  const seq = permissionSeq
  pending = { seq, callId, wait }
  $.clock.after(PERMISSION_GRACE_MS, () => {
    if (pending?.seq !== seq) return
    pending = null
    if (callId !== null && (callsExecuting.has(callId) || callsFinished.includes(callId))) return
    void saveReport($, { state: 'waiting', waiting: { ...wait, since: Date.now() } })
  })
}

function toPatch(found: Classification, classified: boolean): Partial<Report> {
  if (found.kind === 'none') return { state: 'idle', waiting: null }
  const { kind, why, question, options, recap } = found
  return { state: 'waiting', waiting: { kind, why, question, options, recap, since: Date.now(), classified } }
}

// Shows the session as waiting at once, then refines why off the turn's own
// dispatch, so a slow model never holds up the end of the turn. A refinement
// that lands after the next turn started is dropped.
async function reportTurnEnd($: Engine, answer: string, isAnswered: boolean): Promise<void> {
  const turn = turnSeq
  const location = {
    ...(await followLocation($)),
    lastMessage: answer.trim() === '' ? null : cutMessage(answer),
    aiTitle: await claudeTitle($),
  }
  if (!isAnswered || answer.trim() === '') {
    await saveReport($, { ...location, state: 'idle', waiting: null })
    return
  }
  await saveReport($, { ...location, ...toPatch(fallbackClassification(answer), false) })
  $.clock.after(0, () => {
    const context = { firstPrompt: current?.title ?? null, claudeTitle: current?.aiTitle ?? null, branch: current?.branch ?? null }
    const topicNow = current?.topic ?? ''
    void classifyTurn($, answer, topicNow, context).then(async found => {
      if (turn !== turnSeq) return
      await saveReport($, toPatch(found, true))
      await adoptTopic($, stableTopic(current?.topic ?? topicNow, found.topic))
    })
  })
}

// The title Claude Code gave the conversation (what its terminal tab shows),
// from the tail of the session's own transcript.
async function claudeTitle($: Engine): Promise<string | null> {
  if (!current || !claudeHome || !startCwd) return current?.aiTitle ?? null
  try {
    const run = await $.process.run(['tail', '-c', String(TAIL_BYTES), transcriptPath(claudeHome, startCwd, current.sessionId)])
    return (run.exitCode === 0 ? parseTail(run.stdout).title : null) ?? current.aiTitle ?? null
  } catch {
    return current.aiTitle ?? null
  }
}

// A new topic names the session's front, and the session itself unless the
// user named it or another session has that name. The coordinator keeps its
// name: it talks about the other fronts, so its topic is usually theirs.
async function adoptTopic($: Engine, topic: string): Promise<void> {
  if (!current || !claudeHome || topic === '' || topic === current.topic) return
  await saveReport($, { topic })
  if (isCoordinating()) return
  if (!(await mayRename($, claudeHome, current.sessionId, current.autoName ?? null, topic))) return
  if (await renameSession($, topic)) await saveReport($, { autoName: topic })
}

// After /clear (or a resume inside the session) the engine goes on under a
// new id without a session.start: the next turn moves the report over.
async function followSessionId($: Engine): Promise<void> {
  if (!current) return
  const id = await $.session.id()
  if (id !== current.sessionId) await startReport($, current.cwd, id)
}

export function registerReporter(on: On): void {
  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      turnSeq += 1
      await followSessionId($)
      pending = null
      // A title saved before pastes were skipped (a bare paste tag) is no title.
      const saved = current?.title ? firstLine(current.title) : null
      const title = saved ?? firstLine(e.text)
      await saveReport($, { state: 'running', waiting: null, title })
    }
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    const activity = `${e.tool}: ${summarizeInput(e.tool, e)}`
    if (current) current = { ...current, activity, steps: [...(current.steps ?? []), activity].slice(-STEPS_KEPT) }
    if (Date.now() - lastWrite >= ACTIVITY_WRITE_MS) await saveReport($, {})
    const callId = e.tool_use_id
    callsUnderWay.push(callId)
    try {
      return await next(e)
    } finally {
      callsUnderWay.splice(callsUnderWay.indexOf(callId), 1)
      callsExecuting.delete(callId)
      callsFinished.push(callId)
      if (callsFinished.length > FINISHED_KEPT) callsFinished.shift()
      if (pending?.callId === callId || pending?.callId === null) pending = null
      if (current?.state === 'waiting') await saveReport($, { state: 'running', waiting: null })
    }
  })

  // The fallback until PermissionRequest is seen to reach this mod: where
  // settings hooks do not run for plugins (an organization's managed settings
  // can turn them off), or where a plugin of a tier above answers it first (a
  // security plugin may), an ask a person may answer marks the wait. It cannot
  // tell a dialog from auto mode's classifier, which allows the call and
  // leaves the wait up while the command runs, so once PermissionRequest has
  // run, only that marks one. No probe on classic.PreToolUse: a plugin above
  // that sends it past this mod gets the user a skip notice for nothing.
  on('tool.check', async ($, e, next) => {
    const verdict = await next(e)
    const asksPerson = verdict.decision === 'ask' && e.approver === 'person' && e.tool_use_id !== undefined
    if (asksPerson && e.agentId === undefined && !classicHooksRun) {
      await markPermission($, e.tool, e.input, e.tool_use_id ?? null)
    }
    return verdict
  })

  // Fires when a dialog is raised, where no other plugin answers it first (a
  // security plugin may: the tool.check above covers that). In auto mode it
  // can fire while the classifier still decides, hence the grace period. It
  // names no call: the main loop's newest one is the one asking.
  on('classic.PermissionRequest', async ($, e, next) => {
    classicHooksRun = true
    if (e.agent_id === undefined) {
      await markPermission($, e.tool_name, e.tool_input, callsUnderWay[callsUnderWay.length - 1] ?? null)
    }
    return next(e)
  })

  // The engine draws a command's "run in background" pill once it executes:
  // its permission, if it had to ask one, is settled. Drawing changes nothing;
  // a wait already shown for it clears off the drawing.
  on('ui.render', { component: 'ToolProgress' }, ($, e, next) => {
    const callId = e.props.tool_use_id
    if (callsUnderWay.includes(callId) && !callsExecuting.has(callId)) {
      callsExecuting.add(callId)
      if (pending?.callId === callId) pending = null
      if (current?.state === 'waiting' && current.waiting?.why.startsWith(PERMISSION_PREFIX)) {
        $.clock.after(0, () => void saveReport($, { state: 'running', waiting: null }))
      }
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined && current) await reportTurnEnd($, e.answer, !e.isAborted && e.reason === 'answer')
    return result
  })

  on('session.end', async ($, e, next) => {
    turnSeq += 1 // drops a classification still on its way
    await saveReport($, { state: 'ended', waiting: null })
    return next(e)
  })
}
