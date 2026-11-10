// The user's corrections to the fronts (merges, names, dismissals), shared by
// every panel through the plugin's store.
import type { Hook } from 'claude-code'

import type { FrontOverrides } from './fronts'

type Engine = Parameters<Hook<'session.start'>>[0]

const OVERRIDES_KEY = 'overrides'

function isRecordOfStrings(value: unknown): value is Record<string, string> {
  return typeof value === 'object' && value !== null && Object.values(value).every(one => typeof one === 'string')
}

function isRecordOfNumbers(value: unknown): value is Record<string, number> {
  return typeof value === 'object' && value !== null && Object.values(value).every(one => typeof one === 'number')
}

export async function readOverrides($: Engine): Promise<FrontOverrides> {
  const stored: unknown = await $.store.get(OVERRIDES_KEY)
  const pick = (key: string): unknown => (typeof stored === 'object' && stored !== null ? Reflect.get(stored, key) : undefined)
  const [aliases, names, dismissed] = [pick('aliases'), pick('names'), pick('dismissed')]
  return {
    aliases: isRecordOfStrings(aliases) ? aliases : {},
    names: isRecordOfStrings(names) ? names : {},
    dismissed: isRecordOfNumbers(dismissed) ? dismissed : {},
  }
}

export async function writeOverrides($: Engine, overrides: FrontOverrides): Promise<void> {
  await $.store.set(OVERRIDES_KEY, overrides)
}

// Read again right before the write: a merge or rename made meanwhile is kept.
export async function dismissFronts($: Engine, ids: string[], now: number): Promise<void> {
  if (ids.length === 0) return
  const overrides = await readOverrides($)
  for (const id of ids) overrides.dismissed[id] = now
  await writeOverrides($, overrides)
}
