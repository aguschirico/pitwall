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
