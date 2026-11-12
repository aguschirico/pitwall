// The user's options for this mod, from the manifest's userConfig. A change in
// the config menu reloads the module, so the values are read once at register.
import type { PluginOptions } from 'claude-code'

export const DEFAULT_REFRESH_S = 5
export const MIN_REFRESH_S = 2
export const MAX_REFRESH_S = 120

// How often the panel reads the other sessions, in ms: the user's number of
// seconds held to 2..120, or 5 when it is missing or not a number.
export function refreshMsFrom(options: PluginOptions): number {
  const raw = options.refreshSeconds
  const seconds = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : Number.NaN
  if (!Number.isFinite(seconds)) return DEFAULT_REFRESH_S * 1000
  return Math.round(Math.min(MAX_REFRESH_S, Math.max(MIN_REFRESH_S, seconds)) * 1000)
}

export const DEFAULT_STUCK_MIN = 5
export const MAX_STUCK_MIN = 1440

// After how long a wait on the user counts as stuck, in ms, or null when the
// badge is off (0). Missing or not a number means 5 minutes; at most a day.
export function stuckMsFrom(options: PluginOptions): number | null {
  const raw = options.stuckMinutes
  const minutes = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : Number.NaN
  if (!Number.isFinite(minutes)) return DEFAULT_STUCK_MIN * 60_000
  if (minutes <= 0) return null
  return Math.round(Math.min(MAX_STUCK_MIN, minutes) * 60_000)
}

let stuckAfter: number | null = DEFAULT_STUCK_MIN * 60_000

// How long a front with no open session stays on the panel: 1 to 7 days,
// 1 by default. Its reports are kept the 7 days whatever the choice.
export const DEFAULT_CLOSED_DAYS = 1
export const MAX_CLOSED_DAYS = 7
const DAY = 24 * 60 * 60 * 1000

export function closedMsFrom(options: PluginOptions): number {
  const raw = options.closedDays
  const days = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : Number.NaN
  if (!Number.isFinite(days)) return DEFAULT_CLOSED_DAYS * DAY
  return Math.round(Math.min(MAX_CLOSED_DAYS, Math.max(DEFAULT_CLOSED_DAYS, days)) * DAY)
}

let closedWindow = DEFAULT_CLOSED_DAYS * DAY

export function setClosedWindowMs(ms: number): void {
  closedWindow = ms
}

export function closedWindowMs(): number {
  return closedWindow
}

export function setStuckAfterMs(ms: number | null): void {
  stuckAfter = ms
}

export function stuckAfterMs(): number | null {
  return stuckAfter
}

// Whether a wait that turns stuck also raises a native notification. On
// unless the user turned it off; with the badge off there is nothing to tell.
export function notifyStuckFrom(options: PluginOptions): boolean {
  const raw = options.stuckNotify
  return raw !== false && raw !== 'false'
}

let notifyStuck = true

export function setNotifyStuck(value: boolean): void {
  notifyStuck = value
}

export function notifiesStuck(): boolean {
  return notifyStuck
}

// Which messages the approval word rule reads. "off" (the default): none, since
// a word match cannot tell "push it" from "don't push, we are in a demo", and
// the warnings are what sessions most need to pass along; "drafted": what the
// coordinator's model wrote; "strict": every message, the user's included.
// Whatever the choice, a session waiting on an approval takes no message, and
// drafted text needs the user's yes.
export const APPROVAL_CHECKS = ['off', 'drafted', 'strict'] as const
export type ApprovalCheck = (typeof APPROVAL_CHECKS)[number]
export const DEFAULT_APPROVAL_CHECK: ApprovalCheck = 'off'

function isApprovalCheck(value: unknown): value is ApprovalCheck {
  return APPROVAL_CHECKS.some(one => one === value)
}

export function approvalCheckFrom(options: PluginOptions): ApprovalCheck {
  const raw = options.approvalCheck
  return isApprovalCheck(raw) ? raw : DEFAULT_APPROVAL_CHECK
}

let approvalCheck: ApprovalCheck = DEFAULT_APPROVAL_CHECK

export function setApprovalCheck(value: ApprovalCheck): void {
  approvalCheck = value
}

// Whether the words of a message by this author are checked for approvals.
export function checksWords(author: 'typed' | 'confirmed'): boolean {
  if (approvalCheck === 'off') return false
  return approvalCheck === 'strict' || author === 'confirmed'
}
