// Decides, from the last thing a session said, whether it waits on the user
// and why. Runs once per finished turn, never on a timer.
import type { Hook } from 'claude-code'

import { isWaitKind, type WaitKind } from './report'

type Engine = Parameters<Hook<'session.start'>>[0]

export type Classification = {
  kind: WaitKind | 'none'
  why: string
  question: string
  options: string[]
  recap: string
  // What the session works on, in 3 to 6 words: its name on the panel.
  topic: string
}

const MESSAGE_MAX = 6_000
const LINE_MAX = 120
const TOPIC_MAX = 48
const MODEL = 'haiku'
const TIMEOUT_MS = 20_000

const INSTRUCTIONS = `Classify the last message a coding assistant sent to its user. Reply with JSON only:
{"kind": "...", "why": "...", "question": "...", "options": ["..."], "recap": "...", "topic": "..."}
kind is one of:
- "decision": it asks the user to choose between options or to answer something before it can go on
- "ok-push": it asks permission to commit, push, open or merge a PR, or deploy
- "manual": it asks for something only the user can do (log in, run SQL in production, act outside this machine)
- "review": it left something ready for the user to look at
- "none": it finished and only reports back, nothing to answer
why: at most 80 characters, in the message's language, what the user must do.
question: the question as the message asks it ("" for none).
options: the literal options it offers, or [].
recap: at most 160 characters, what it did just before.
topic: 3 to 6 words, in the message's language, naming the work the session is on ("Search cache", "Desktop toast fix"). Keep the current topic unless the work clearly changed.

The message:
`

export function buildClassifyPrompt(lastAssistant: string, currentTopic = ''): string {
  const topic = currentTopic === '' ? 'Current topic: none yet.\n\n' : `Current topic: ${currentTopic}\n\n`
  return INSTRUCTIONS.replace('The message:\n', `${topic}The message:\n`) + lastAssistant.slice(0, MESSAGE_MAX)
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
  return { kind, why, question, options, recap, topic }
}

export function fallbackClassification(lastAssistant: string): Classification {
  const line = lastAssistant.split('\n').find(one => one.trim() !== '')?.trim() ?? ''
  const why = line.slice(0, LINE_MAX)
  return { kind: 'review', why, question: why, options: [], recap: '', topic: '' }
}

export async function classifyTurn($: Engine, lastAssistant: string, currentTopic = ''): Promise<Classification> {
  try {
    const reply = await $.model.complete({
      model: MODEL,
      prompt: buildClassifyPrompt(lastAssistant, currentTopic),
      timeoutMs: TIMEOUT_MS,
    })
    if (!reply.isAnswered) return fallbackClassification(lastAssistant)
    return parseClassification(reply.text) ?? fallbackClassification(lastAssistant)
  } catch {
    return fallbackClassification(lastAssistant)
  }
}
