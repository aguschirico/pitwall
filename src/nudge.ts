// The nudge: a native notification when a wait on the user turns stuck, once
// per wait. The waits already told are kept in a file every panel shares, so
// two panels open on the same machine do not both notify.
import type { Hook } from 'claude-code'

import { age, isStuck, TAG } from './format'
import type { Front } from './fronts'

type Engine = Parameters<Hook<'session.start'>>[0]
type Reader = { read: (path: string) => Promise<string> }

export type Nudge = { key: string; title: string; text: string }

// What a told wait is remembered for: long enough that no wait comes back.
const KEEP_MS = 7 * 24 * 60 * 60_000

export function notifiedPath(claudeHome: string): string {
  return `${claudeHome}/pitwall/notified.json`
}

// A wait is one front waiting since one moment: a new wait on the same front
// (it went on and stopped again) is told again.
function keyOf(front: Front): string | null {
  return front.waiting ? `${front.id}@${front.waiting.since}` : null
}

export function stuckNudges(fronts: Front[], now: number, stuckAfter: number | null): Nudge[] {
  return fronts.flatMap(front => {
    const key = keyOf(front)
    if (!key || !front.waiting || !isStuck(front, now, stuckAfter)) return []
    return [{
      key,
      title: `pitwall · ${TAG[front.waiting.kind]}`,
      text: `${front.name} waits on you (${age(now - front.waiting.since)}): ${front.waiting.why}`,
    }]
  })
}

export function parseNotified(text: string): Record<string, number> {
  try {
    const value: unknown = JSON.parse(text)
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
    return Object.fromEntries(Object.entries(value).filter((one): one is [string, number] => typeof one[1] === 'number'))
  } catch {
    return {}
  }
}

async function readNotified(io: Reader, claudeHome: string): Promise<Record<string, number>> {
  try {
    return parseNotified(await io.read(notifiedPath(claudeHome)))
  } catch {
    return {}
  }
}

// Tells the user about each wait that turned stuck since the last look. On a
// panel's first refresh it only writes down the waits already stuck: the user
// is opening the panel and sees them there, so a burst of old ones is noise.
export async function nudgeStuck($: Engine, io: Reader, claudeHome: string, fronts: Front[], now: number, stuckAfter: number | null, seedOnly: boolean): Promise<void> {
  const nudges = stuckNudges(fronts, now, stuckAfter)
  if (nudges.length === 0) return
  const told = await readNotified(io, claudeHome)
  const fresh = nudges.filter(one => told[one.key] === undefined)
  if (fresh.length === 0) return
  const kept = Object.fromEntries(Object.entries(told).filter(([, at]) => now - at < KEEP_MS))
  for (const one of fresh) kept[one.key] = now
  // Written before notifying: another panel reading it now finds them told.
  await $.fs.write(notifiedPath(claudeHome), JSON.stringify(kept))
  if (seedOnly) return
  for (const one of fresh) {
    try {
      await $.ui.notify(one.text, { title: one.title, key: one.key })
    } catch {
      // A hook refused it or the channel failed: the badge is still on the panel.
    }
  }
}
