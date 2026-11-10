// Decides whether the coordinator may pass the user's words to a front, and
// to which session. Approvals never travel: they are answered in the session.
// Conservative by design: a refusal costs a window switch, a wrong relay can
// cost a push or a production change.
// The word rule is one layer: what the model drafts also needs the user's yes
// in a dialog (tools.ts), and the receiving session keeps its own permissions.
import { sessionWhere } from './format'
import type { Front, FrontSession } from './fronts'
import { PERMISSION_PREFIX, type Waiting } from './report'
import { foldForMatch } from './untrusted'

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

// The approval word in the text, folded (invisible characters out, lookalike
// letters and spelled-out words read as plain ones), or null: the refusal quotes it.
export function approvalWord(text: string): string | null {
  const folded = foldForMatch(text)
  return STEM_PATTERN.exec(folded)?.[1] ?? WORD_PATTERN.exec(folded)?.[1] ?? null
}

// Why words with an approval in them are not sent, or null. `after` says where to go instead.
export function approvalRefusal(text: string, after = ''): string | null {
  const word = approvalWord(text)
  if (!word) return null
  return `Not sent: the message says ${JSON.stringify(word)}, and push, PR, merge, deploy or prod never travel through the panel.${after}`
}

export type RelayPlan = { ok: true; sessionId: string } | { ok: false; reason: string }

// Who stands behind the words: the user typed them (/coordinate), or the
// coordinator's model drafted them and the user said yes to them in a dialog.
export type Author = 'typed' | 'confirmed'

const AUTHOR_LINE: Record<Author, string> = {
  typed: 'Relayed from the coordinator session, typed by the user',
  confirmed: "Relayed from the coordinator session, drafted by its model and confirmed by the user",
}

// What the receiving session reads. The words go in JSON quotes, so a quote or
// a line break in them cannot close the envelope and speak in its voice.
export function relayMessage(text: string, author: Author): string {
  return `${AUTHOR_LINE[author]}: ${JSON.stringify(text)}`
}

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

// Null when the words may go; otherwise why not. A session waiting on an approval takes nothing
// through the panel: any words could be read as the answer.
export function refusal(session: FrontSession, text: string): string | null {
  const wait = session.report.state === 'waiting' ? session.report.waiting : null
  const where = sessionWhere(session)
  // An unclassified wait might be an approval: refused, saying why it is unknown.
  if (wait !== null && !wait.classified) {
    return session.reported
      ? `Still reading what that session asks: try again in a few seconds or answer it in ${where}.`
      : `That session does not have the mod loaded, so what it asks is unknown: answer it in ${where}, or run /reload-plugins there.`
  }
  const word = approvalRefusal(text, ` Say it in ${where}.`)
  if (word) return word
  if (wait !== null && asksApproval(session)) {
    return `Not sent: ${isPermissionDialog(wait) ? WAIT_REASONS.dialog : WAIT_REASONS.push}. Go to ${where}.`
  }
  return null
}

export function planRelay(front: Front | undefined, text: string): RelayPlan {
  if (!front) return { ok: false, reason: 'No such front.' }
  const session = relayTarget(front)
  if (!session) return { ok: false, reason: `${JSON.stringify(front.name)} has no open session.` }
  const refused = refusal(session, text)
  if (refused) return { ok: false, reason: refused }
  return { ok: true, sessionId: session.report.sessionId }
}
