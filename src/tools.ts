// The tools the coordinator's model calls when the user talks to it: list the
// fronts, pass words to one, and merge, rename or dismiss fronts. Registered
// only in the coordinating session.
import type { Hook, On } from 'claude-code'

import { currentFronts, currentWaitingIds, isCoordinating, refresh } from './coordinator'
import { readOverrides, writeOverrides } from './overrides'
import { TAG } from './format'
import type { Front, FrontOverrides, FrontSession } from './fronts'
import { goToFront } from './focus'
import { planRelay, refusal } from './relay'

type Engine = Parameters<Hook<'session.start'>>[0]

const FRONT_ID = { type: 'string', description: 'The front id from list_fronts, or its exact name.' }

const SPECS = [
  {
    name: 'list_fronts',
    description: 'Lists the fronts of work on the session panel: id, name, section and what each waits for.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'send_to_front',
    description:
      "Passes the user's words, verbatim, to the session of a front. Ask the user first when it is unclear which front they mean. Never use it for approvals (commit, push, PR, merge, deploy, tool permissions): those are answered in the session itself, and the tool refuses them.",
    inputSchema: { type: 'object', properties: { frontId: FRONT_ID, text: { type: 'string' } }, required: ['frontId', 'text'] },
  },
  {
    name: 'merge_fronts',
    description: 'Joins one front into another when they are the same work.',
    inputSchema: { type: 'object', properties: { fromId: FRONT_ID, intoId: FRONT_ID }, required: ['fromId', 'intoId'] },
  },
  {
    name: 'rename_front',
    description: 'Gives a front the name the user wants to see.',
    inputSchema: { type: 'object', properties: { frontId: FRONT_ID, name: { type: 'string' } }, required: ['frontId', 'name'] },
  },
  {
    name: 'dismiss_front',
    description: 'Hides a paused front until it shows new activity.',
    inputSchema: { type: 'object', properties: { frontId: FRONT_ID }, required: ['frontId'] },
  },
] as const

export async function registerTools($: Engine): Promise<void> {
  for (const spec of SPECS) await $.tool.register({ ...spec, isDeferred: false })
}

// A front by id, or by a name only one front has; a string says why not.
function findFront(key: unknown): Front | string {
  if (typeof key !== 'string') return 'No such front.'
  const byId = currentFronts().find(front => front.id === key)
  if (byId) return byId
  const byName = currentFronts().filter(front => front.name === key)
  if (byName.length > 1) return `More than one front is named ${key}: ${byName.map(front => front.id).join(', ')}.`
  return byName[0] ?? 'No such front.'
}

function listText(fronts: Front[]): string {
  if (fronts.length === 0) return 'No open fronts.'
  return fronts
    .map(front => {
      const waits = front.waiting ? ` | ${TAG[front.waiting.kind]}: ${front.waiting.why}` : ''
      return `${front.id} | ${front.name} | ${front.section}${waits}`
    })
    .join('\n')
}

async function sendToFront($: Engine, frontKey: unknown, text: unknown): Promise<string> {
  if (typeof text !== 'string' || text.trim() === '') return 'Missing the text to send.'
  const front = findFront(frontKey)
  if (typeof front === 'string') return front
  const plan = planRelay(front, text)
  if (!plan.ok) return plan.reason
  const sent = await $.session.send({ to: { sessionId: plan.sessionId }, text: plan.message })
  return sent.isDelivered ? `Sent to ${front.name}.` : `Could not send: ${sent.reason}`
}

async function changeOverrides($: Engine, change: (overrides: FrontOverrides) => string | null): Promise<string> {
  const overrides = await readOverrides($)
  const problem = change(overrides)
  if (problem) return problem
  await writeOverrides($, overrides)
  await refresh($)
  return 'Done.'
}

function resolveId(key: unknown): string | null {
  const front = findFront(key)
  return typeof front === 'string' ? null : front.id
}

// The session of a front a message is addressed to, by id or by name.
function frontSessionFor(to: string): FrontSession | null {
  for (const front of currentFronts()) {
    const found = front.sessions.find(one => one.report.sessionId === to || one.live?.name === to)
    if (found) return found
  }
  return null
}

const COORDINATE_USAGE =
  'Usage: /coordinate <number> <text>, or /coordinate <number> go to jump to that session, with the row number in "Waiting on you".'

// "/coordinate 2 pick B": the text goes to the second waiting front, under
// the same rules as send_to_front, without the model in between.
async function coordinate($: Engine, args: string): Promise<string> {
  if (!isCoordinating()) return 'This session does not have the panel open: run /panel first.'
  const match = /^\s*(\d+)\s+(\S[\s\S]*)$/.exec(args)
  if (!match) return COORDINATE_USAGE
  const waiting = currentWaitingIds()
  const id = waiting[Number(match[1]) - 1]
  if (!id) return `No session is waiting with number ${match[1]}. There are ${waiting.length}.`
  const text = (match[2] ?? '').trim()
  return /^go$/i.test(text) ? goToFront($, id) : sendToFront($, id, text)
}

export function registerToolHooks(on: On): void {
  on('command.run', { command: 'coordinate' }, async ($, e) => ({ text: await coordinate($, e.args) }))

  // The approval rule holds for every message this coordinator sends to a
  // front's session, SendMessage included, not only for send_to_front.
  on('session.send', async ($, e, next) => {
    if (!isCoordinating()) return next(e)
    const session = frontSessionFor(e.to)
    const refused = session ? refusal(session, e.text) : null
    return refused ? { isDelivered: false, reason: refused } : next(e)
  }).catch(($, e, next) => (next.called ? next(e) : { isDelivered: false, reason: 'Could not check the destination.' }))

  on('tool.call', { tool: 'mcp__pitwall__list_fronts' }, async () => ({ result: listText(currentFronts()) }))

  on('tool.call', { tool: 'mcp__pitwall__send_to_front' }, async ($, e) => ({
    result: await sendToFront($, e.frontId, e.text),
  }))

  on('tool.call', { tool: 'mcp__pitwall__merge_fronts' }, async ($, e) => ({
    result: await changeOverrides($, overrides => {
      const [from, into] = [resolveId(e.fromId), resolveId(e.intoId)]
      if (!from || !into || from === into) return 'Cannot find those two fronts.'
      overrides.aliases[from] = into
      return null
    }),
  }))

  on('tool.call', { tool: 'mcp__pitwall__rename_front' }, async ($, e) => ({
    result: await changeOverrides($, overrides => {
      const id = resolveId(e.frontId)
      if (!id || typeof e.name !== 'string' || e.name.trim() === '') return 'Missing the front or the name.'
      overrides.names[id] = e.name.trim()
      return null
    }),
  }))

  on('tool.call', { tool: 'mcp__pitwall__dismiss_front' }, async ($, e) => {
    const now = await $.clock.now()
    return {
      result: await changeOverrides($, overrides => {
        const id = resolveId(e.frontId)
        if (!id) return 'No such front.'
        overrides.dismissed[id] = now
        return null
      }),
    }
  })
}
