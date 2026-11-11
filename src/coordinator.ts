// The coordinator: `/panel` makes this session the one that watches the
// others. Every refresh interval (5 seconds unless the user set another) it
// reads the reports and the registry, groups them
// into fronts and stores the worded panel the pane draws.
import { atom, read, update } from 'claude-code'
import type { Hook, On, Timer } from 'claude-code'

import { assignNumbers, drawnRows, toView, withNumbers } from './format'
import { buildFronts, type Front } from './fronts'
import { readOverrides } from './overrides'
import { PANE_ID, PANE_TITLE, setView } from './pane'
import { claudeHomeOf } from './paths'
import { ioFrom, type Io } from './registry'
import { computeSnapshot, readSnapshot, type Snapshot } from './snapshot'
import { nudgeStuck } from './nudge'
import { DEFAULT_REFRESH_S, notifiesStuck, stuckAfterMs } from './settings'
import { registerTools } from './tools'

type Engine = Parameters<Hook<'session.start'>>[0]

export const DEFAULT_REFRESH_MS = DEFAULT_REFRESH_S * 1000

// The interval this session refreshes at, set from the user's options at register.
let refreshMs = DEFAULT_REFRESH_MS

export function setRefreshMs(ms: number): void {
  refreshMs = ms
}

export function currentRefreshMs(): number {
  return refreshMs
}

export const coordinator = atom({ plugin: 'pitwall', key: 'coordinator' } as const, false, { shape: 'coordinator-1' })

let ticker: Timer | null = null
let refreshing = false
let coordinating = false
let lastFronts: Front[] = []
let rowNumbers: Record<string, number> = {}
let refreshedOnce = false

export function currentFronts(): Front[] {
  return lastFronts
}

// The front drawn with this number on the panel, if any.
export function frontIdForNumber(number: number): string | undefined {
  return Object.entries(rowNumbers).find(([, one]) => one === number)?.[0]
}

// The shared snapshot when another panel wrote it within this panel's own
// interval, else a fresh one this panel computes and writes for the others.
// The stale one still lends its PR chips that are recent enough.
async function latestSnapshot($: Engine, io: Io, claudeHome: string, now: number): Promise<Snapshot> {
  const shared = await readSnapshot(io, claudeHome)
  if (shared && now - shared.at < refreshMs) return shared
  return computeSnapshot($, io, claudeHome, now, shared)
}

async function refreshOnce($: Engine): Promise<void> {
  const io = ioFrom($)
  const now = await $.clock.now()
  const claudeHome = (await claudeHomeOf($)) ?? ''
  const snapshot = await latestSnapshot($, io, claudeHome, now)
  const self = await $.session.id()
  const others = <T extends { sessionId: string }>(list: T[]) => list.filter(one => one.sessionId !== self)
  lastFronts = buildFronts({
    reports: others(snapshot.reports),
    inferred: others(snapshot.inferred),
    live: others(snapshot.live),
    overrides: await readOverrides($),
    now,
  })
  const view = toView(lastFronts, now, { pr: snapshot.pr, git: snapshot.git, stuckAfter: stuckAfterMs() })
  rowNumbers = assignNumbers(rowNumbers, drawnRows(view))
  const panel = withNumbers(view, rowNumbers)
  await setView($, panel)
  const firstRefresh = !refreshedOnce
  refreshedOnce = true
  if (notifiesStuck()) await nudgeStuck($, io, claudeHome, lastFronts, now, stuckAfterMs(), firstRefresh)
}

// False until the first refresh lands: before it no session is known, so the
// coordinator cannot tell a front's session from any other and sends nothing.
export function hasRefreshed(): boolean {
  return refreshedOnce
}

// One refresh at a time; a tick that finds one running is skipped. A failed
// refresh leaves the last panel in place.
export async function refresh($: Engine): Promise<void> {
  if (refreshing) return
  refreshing = true
  try {
    await refreshOnce($)
  } catch {
    // The next tick tries again.
  } finally {
    refreshing = false
  }
}

async function startWatching($: Engine): Promise<void> {
  coordinating = true
  await registerTools($)
  if (ticker === null) ticker = $.clock.every(refreshMs, () => void refresh($))
  $.clock.after(0, () => void refresh($))
}

export function isCoordinating(): boolean {
  return coordinating
}

// Runs at every session start (and reload): offers /panel everywhere and
// resumes watching where this session already coordinated.
export async function startCoordinator($: Engine): Promise<void> {
  await $.command.register({ name: 'panel', description: 'Opens the session panel and makes this session the coordinator' })
  await $.command.register({
    name: 'coordinate',
    description: 'Answers a session that waits on you, by its number on the panel',
    argumentHint: '<number> <text>',
  })
  if (await read($, coordinator)) await startWatching($)
}

export function registerCoordinator(on: On): void {
  on('command.run', { command: 'panel' }, async $ => {
    await update($, coordinator, () => true)
    await $.ui.open({ id: PANE_ID, title: PANE_TITLE })
    try {
      await startWatching($)
    } catch {
      return { text: 'Panel open, but the sessions could not be watched.' }
    }
    return { text: 'Panel open: this session coordinates the others.' }
  })
}
