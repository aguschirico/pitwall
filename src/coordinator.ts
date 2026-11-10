// The coordinator: `/panel` makes this session the one that watches the
// others. Every REFRESH_MS it reads the reports and the registry, groups them
// into fronts and stores the worded panel the pane draws.
import { atom, read, update } from 'claude-code'
import type { Hook, On, Timer } from 'claude-code'

import { toView } from './format'
import { buildFronts, type Front } from './fronts'
import { PANE_ID, PANE_TITLE, setView } from './pane'
import { readOverrides } from './overrides'
import { ioFrom, type Io } from './registry'
import { computeSnapshot, readSnapshot, SNAPSHOT_TTL_MS, type Snapshot } from './snapshot'
import { registerTools } from './tools'

type Engine = Parameters<Hook<'session.start'>>[0]

export const REFRESH_MS = 15_000

export const coordinator = atom({ plugin: 'pitwall', key: 'coordinator' } as const, false, { shape: 'coordinator-1' })

let ticker: Timer | null = null
let refreshing = false
let coordinating = false
let lastFronts: Front[] = []
let lastWaitingIds: string[] = []

export function currentFronts(): Front[] {
  return lastFronts
}

// The ids of the "Waiting on you" rows in the order the panel numbers them.
export function currentWaitingIds(): string[] {
  return lastWaitingIds
}

// The shared snapshot when another panel wrote it lately, else a fresh one
// this panel computes and writes for the others.
async function latestSnapshot($: Engine, io: Io, home: string, now: number): Promise<Snapshot> {
  const shared = await readSnapshot(io, home)
  if (shared && now - shared.at < SNAPSHOT_TTL_MS) return shared
  return computeSnapshot($, io, home, now)
}

async function refreshOnce($: Engine): Promise<void> {
  const io = ioFrom($)
  const now = await $.clock.now()
  const home = (await $.env.get('HOME')) ?? ''
  const snapshot = await latestSnapshot($, io, home, now)
  const self = await $.session.id()
  const others = <T extends { sessionId: string }>(list: T[]) => list.filter(one => one.sessionId !== self)
  lastFronts = buildFronts({
    reports: others(snapshot.reports),
    inferred: others(snapshot.inferred),
    live: others(snapshot.live),
    overrides: await readOverrides($),
    now,
  })
  const panel = toView(lastFronts, now, { pr: snapshot.pr, git: snapshot.git })
  lastWaitingIds = panel.waiting.map(row => row.id)
  await setView($, panel)
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
  if (ticker === null) ticker = $.clock.every(REFRESH_MS, () => void refresh($))
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
