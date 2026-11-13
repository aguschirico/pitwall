// Decides, from the last thing a session said, whether it waits on the user
// and why. Runs once per finished turn, never on a timer.
import type { Hook } from 'claude-code'

import { isWaitKind, type WaitKind } from './report'
import { cutAtWord } from './untrusted'

type Engine = Parameters<Hook<'session.start'>>[0]

export type Classification = {
  kind: WaitKind | 'none'
  why: string
  question: string
  options: string[]
  recap: string
  // What the session as a whole is about, in 2 to 5 words: its name on the panel.
  topic: string
}

// What the session was opened for, so its name says that and not the turn's step.
export type SessionContext = {
  // The first line of the user's first prompt.
  firstPrompt?: string | null
  // The title Claude Code gave the conversation.
  claudeTitle?: string | null
  branch?: string | null
}

const MESSAGE_MAX = 6_000
const LINE_MAX = 120
const TOPIC_MAX = 48
const MODEL = 'haiku'
const TIMEOUT_MS = 20_000

const INSTRUCTIONS = `Classify the last message a coding assistant sent to its user. Reply with JSON only:
{"kind": "...", "why": "...", "question": "...", "options": ["..."], "recap": "...", "topic": "..."}
kind is one of:
- "decision": it asks the user to choose between options or to answer something before it can go on, or it offers a next step and waits for the user's go ("I can start X meanwhile", "want me to...?"), even when the offer is not phrased as a question
- "ok-push": it asks permission to commit, push, open or merge a PR, or deploy, or says work stays held until the user OKs one of those ("the commits stay local until you OK the push"), and offers nothing else
- "manual": it asks for something only the user can do (log in, run SQL in production, act outside this machine)
- "review": it left something ready for the user to look at
- "none": it finished and only reports back: no question, no offer of a next step, nothing held for the user's OK
A message that offers a next step and also holds a push for the user's OK is "decision": the offer can be answered from elsewhere, the push OK is given in the session.
Waiting on someone else (a reviewer, a teammate's answer) is not by itself a wait on the user.
why: at most 80 characters, in the message's language, what the user must do.
question: the question as the message asks it ("" for none).
options: the literal options it offers, or [].
recap: at most 160 characters, what it did just before.
topic: 2 to 5 words, in the message's language, naming what the whole session is about: its goal or the area it works on, the thing that stays true from turn to turn ("Search cache", "Desktop toast fix", "Checkout PR reviews"). Draw it from the session context below more than from this one message, which is only the latest step. Never the step of the moment: no PR, issue or ticket numbers, no "review", "findings", "fixes", "next steps" or "status" naming one turn ("Revisión PR #4002", "Revisión y hallazgos #563" are wrong; "Revisión de PRs de pagos" is right). Keep the current topic unless the session's goal changed; replace it when it names a single step, PR, issue or number instead of the goal.

The message:
`

const CONTEXT_MAX = 300

function contextLines(context: SessionContext): string {
  const line = (label: string, value: string | null | undefined) => (value && value.trim() !== '' ? [`${label}: ${value.trim().slice(0, CONTEXT_MAX)}`] : [])
  const lines = [
    ...line('First thing the user asked', context.firstPrompt),
    ...line('Conversation title', context.claudeTitle),
    ...line('Git branch', context.branch),
  ]
  return lines.length === 0 ? '' : `Session context:\n${lines.join('\n')}\n\n`
}

export function buildClassifyPrompt(lastAssistant: string, currentTopic = '', context: SessionContext = {}): string {
  const topic = currentTopic === '' ? 'Current topic: none yet.\n\n' : `Current topic: ${currentTopic}\n\n`
  return INSTRUCTIONS.replace('The message:\n', `${contextLines(context)}${topic}The message:\n`) + lastAssistant.slice(0, MESSAGE_MAX)
}

// A name made of one step's reference: "PR #4002", "#563", "issue 12".
const MOMENT = /#\d+|\b(PR|MR|issue|ticket)\s*#?\d+/i

// The topic to keep: the model's, unless it would swap a name for one that
// only names the step of the moment. A first topic is taken as it comes.
export function stableTopic(current: string, proposed: string): string {
  if (proposed === '') return current
  if (current !== '' && MOMENT.test(proposed) && !MOMENT.test(current)) return current
  return proposed
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string')
}

export function parseClassification(raw: string): Classification | null {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start === -1 || end < start) return null
  let data: unknown
  try {
    data = JSON.parse(raw.slice(start, end + 1))
  } catch {
    return null
  }
  if (!isRecord(data)) return null
  const { kind, why, question, options, recap } = data
  const topic = typeof data.topic === 'string' ? data.topic.trim().slice(0, TOPIC_MAX) : ''
  if (kind !== 'none' && !isWaitKind(kind)) return null
  if (typeof why !== 'string' || typeof question !== 'string' || typeof recap !== 'string') return null
  if (!isStringList(options)) return null
  return { kind, why: cutAtWord(why.trim(), LINE_MAX), question, options, recap, topic }
}

export function fallbackClassification(lastAssistant: string): Classification {
  const line = lastAssistant.split('\n').find(one => one.trim() !== '')?.trim() ?? ''
  const why = cutAtWord(line, LINE_MAX)
  return { kind: 'review', why, question: why, options: [], recap: '', topic: '' }
}

export async function classifyTurn($: Engine, lastAssistant: string, currentTopic = '', context: SessionContext = {}): Promise<Classification> {
  try {
    const reply = await $.model.complete({
      model: MODEL,
      prompt: buildClassifyPrompt(lastAssistant, currentTopic, context),
      timeoutMs: TIMEOUT_MS,
    })
    if (!reply.isAnswered) return fallbackClassification(lastAssistant)
    return parseClassification(reply.text) ?? fallbackClassification(lastAssistant)
  } catch {
    return fallbackClassification(lastAssistant)
  }
}
