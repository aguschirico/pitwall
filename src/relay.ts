// Decides whether the coordinator may pass the user's words to a front, and
// to which session. Approvals never travel: they are answered in the session.
// Conservative by design: a refusal costs a window switch, a wrong relay can
// cost a push or a production change.
import { sessionWhere } from './format'
import type { Front, FrontSession } from './fronts'
import { PERMISSION_PREFIX, type Waiting } from './report'

const WORD = '[\\p{L}\\p{N}_]'

// Matched as the start of a word: "pushing", "despliégalo", "migración".
// Actions with consequences only: a bare "approve the design" is a decision.
// Spanish and English, since the user may write in either.
// Tool permissions are caught by the wait's kind (manual), not by words.
const APPROVAL_STEMS = [
  'push', 'commit', 'merge', 'mergea', 'deploy', 'despleg', 'desplieg', 'despliég',
  'migraci', 'migrat', 'producci', 'production', 'releas', 'pull request',
]

// Matched only as whole words, being prefixes of ordinary ones ("prueba", "subtarea", "shipping").
const APPROVAL_WORDS = [
  'pr', 'prod', 'sql', 'ship', 'sube', 'subir', 'subirlo', 'súbelo', 'súbelos', 'subelo', 'subidlo',
]

const STEM_PATTERN = new RegExp(`(?<!${WORD})(${APPROVAL_STEMS.join('|')})`, 'iu')
const WORD_PATTERN = new RegExp(`(?<!${WORD})(${APPROVAL_WORDS.join('|')})(?!${WORD})`, 'iu')

// The approval word in the text, as written, or null: the refusal quotes it.
export function approvalWord(text: string): string | null {
  return STEM_PATTERN.exec(text)?.[1] ?? WORD_PATTERN.exec(text)?.[1] ?? null
}

export function mentionsApproval(text: string): boolean {
  return approvalWord(text) !== null
}

// The words an answer to a question opens with: "dale", "sí, pero…", "ok, go ahead".
const REPLY_OPENERS = [
  'sí', 'si', 'no', 'dale', 'ok', 'okay', 'oka', 'vale', 'listo', 'adelante', 'hazlo', 'hacelo', 'go',
  'yes', 'yep', 'nope', 'claro', 'perfecto', 'correcto', 'confirmo', 'confirmado', 'bueno', 'genial',
  'de una', 'sigue', 'seguí', 'continúa', 'continua',
  'yeah', 'sure', 'fine', 'continue', 'proceed', 'do it', 'sounds good', 'approved', 'great',
]
const REPLY_PATTERN = new RegExp(`^\\s*(${REPLY_OPENERS.join('|')})(?!${WORD})`, 'iu')
// A reply this short is an answer whatever it says ("ya", "la primera").
const MIN_INSTRUCTION_WORDS = 6

// Whether the words could be taken as the answer to the question the session is waiting on.
function readsAsAnswer(text: string): boolean {
  const words = text.trim().split(/\s+/u).filter(Boolean)
  return words.length < MIN_INSTRUCTION_WORDS || REPLY_PATTERN.test(text)
}

const NOT_AN_ANSWER = 'This does not answer the approval you are waiting on: that one is given in this session.'

export type RelayPlan = { ok: true; sessionId: string; message: string } | { ok: false; reason: string }

// The session whose wait the panel shows (the oldest), else the newest open one.
export function relayTarget(front: Front): FrontSession | null {
  const open = front.sessions.filter(one => one.live !== null)
  const shown = front.waiting
  const asked = shown
    ? open.find(one => one.report.waiting?.since === shown.since && one.report.waiting.why === shown.why)
    : undefined
  if (asked) return asked
  const waiting = open.find(one => one.report.state === 'waiting' && one.report.waiting !== null)
  if (waiting) return waiting
  return [...open].sort((a, b) => b.report.updatedAt - a.report.updatedAt)[0] ?? null
}

// Whether the session waits on an approval is the classifier's call (ok-push,
// manual), not a word search: a session that only talks about push or merge
// is not asking for one.
// A manual task ("run X", "log in") is answered by saying it is done; only an
// open permission dialog cannot be answered by a message.
function isPermissionDialog(wait: Waiting): boolean {
  return wait.kind === 'manual' && wait.why.startsWith(PERMISSION_PREFIX)
}

function asksApproval(session: FrontSession): boolean {
  const wait = session.report.state === 'waiting' ? session.report.waiting : null
  return wait !== null && (wait.kind === 'ok-push' || isPermissionDialog(wait))
}

const WAIT_REASONS = {
  push: 'that session waits for your OK to push, open a PR or merge, and that is answered there',
  dialog: 'that session has a permission dialog open, and that is answered there',
}

// Null when the words may go; otherwise why not. A session waiting on an approval still takes a
// new instruction, as long as nothing in it could be read as the answer: no approval words, not a
// short reply, not opening with one ("yes, but…").
export function refusal(session: FrontSession, text: string): string | null {
  const wait = session.report.state === 'waiting' ? session.report.waiting : null
  const where = sessionWhere(session)
  // An unclassified wait might be an approval: refused, saying why it is unknown.
  if (wait !== null && !wait.classified) {
    return session.reported
      ? `Still reading what that session asks: try again in a few seconds or answer it in ${where}.`
      : `That session does not have the mod loaded, so what it asks is unknown: answer it in ${where}, or run /reload-plugins there.`
  }
  const word = approvalWord(text)
  if (word) return `Not sent: your message says "${word}", and push, PR, merge, deploy or prod never travel through the panel. Say it in ${where}.`
  if (wait !== null && asksApproval(session) && readsAsAnswer(text)) {
    return `Not sent: ${isPermissionDialog(wait) ? WAIT_REASONS.dialog : WAIT_REASONS.push}. Go to ${where}.`
  }
  return null
}

export function planRelay(front: Front | undefined, text: string): RelayPlan {
  if (!front) return { ok: false, reason: 'No such front.' }
  const session = relayTarget(front)
  if (!session) return { ok: false, reason: `${front.name} has no open session.` }
  const refused = refusal(session, text)
  if (refused) return { ok: false, reason: refused }
  const relayed = `Relayed from the coordinator by the user: "${text}"`
  return {
    ok: true,
    sessionId: session.report.sessionId,
    message: asksApproval(session) ? `${relayed}. ${NOT_AN_ANSWER}` : relayed,
  }
}
