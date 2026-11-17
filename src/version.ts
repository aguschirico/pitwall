// Which pitwall each session runs, against the one installed. A session keeps
// the code it started with until it restarts, so `claude plugin update` does
// not reach the sessions already open: the panel says which ones lag behind.
import type { Hook } from 'claude-code'

import type { Io } from './registry'

type Engine = Parameters<Hook<'session.start'>>[0]

const PLUGIN_NAME = 'pitwall'

function field(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? Reflect.get(value, key) : undefined
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

const VERSION = /^\d+(\.\d+)*$/

function versionOrNull(value: unknown): string | null {
  return typeof value === 'string' && VERSION.test(value) ? value : null
}

// "0.1.9" against "0.1.10", part by part: below zero when `a` is older.
export function compareVersions(a: string, b: string): number {
  const left = a.split('.').map(Number)
  const right = b.split('.').map(Number)
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

// The version in a plugin.json.
export function manifestVersion(text: string): string | null {
  return versionOrNull(field(parseJson(text), 'version'))
}

// The newest pitwall in Claude Code's installed_plugins.json, from whichever
// marketplace and scope installed it.
export function installedVersion(text: string): string | null {
  const plugins = field(parseJson(text), 'plugins')
  if (typeof plugins !== 'object' || plugins === null) return null
  const versions = Object.entries(plugins)
    .filter(([key]) => key.split('@')[0] === PLUGIN_NAME)
    .flatMap(([, entries]) => (Array.isArray(entries) ? entries : [entries]))
    .map(entry => versionOrNull(field(entry, 'version')))
    .filter((version): version is string => version !== null)
  return versions.sort(compareVersions).pop() ?? null
}

// A session runs an older pitwall than the installed one. A report with no
// version was written before reports carried it, so by an older one too.
// A session newer than the installed one (a plugin folder in development) is not behind.
export function isBehind(running: string | null | undefined, installed: string | null): boolean {
  if (installed === null) return false
  return !running || compareVersions(running, installed) < 0
}

// The version this session loaded, from the plugin.json beside its code.
export async function ownVersion($: Engine): Promise<string | null> {
  try {
    return manifestVersion(await $.fs.read(`${$.plugin.root}/.claude-plugin/plugin.json`))
  } catch {
    return null
  }
}

export async function readInstalledVersion(io: Io, claudeHome: string): Promise<string | null> {
  try {
    return installedVersion(await io.read(`${claudeHome}/plugins/installed_plugins.json`))
  } catch {
    return null
  }
}
