// Where a repository's own main line stands: the local main branch against
// origin's. origin's copy is only as fresh as the last fetch, so the panel
// fetches that one branch itself, at most every few minutes per repository,
// with no prompt: a fetch that would ask for a password or passphrase fails.
import { baseOf, parseAheadBehind } from './git'
import type { Io } from './registry'

export const FETCH_TTL_MS = 5 * 60_000
const FETCH_TIMEOUT_MS = 20_000

export type MainLine = {
  // origin's main, as "origin/main", and the local branch it maps to.
  base: string
  local: string
  hasLocal: boolean
  // Commits the local main has that origin's does not, and the other way.
  ahead: number
  behind: number
  // The last fetch the panel made that worked, and whether the latest failed.
  fetchedAt: number | null
  fetchFailed: boolean
}

export type FetchRecord = { tried: number; ok: boolean; okAt: number | null }

// "origin/main" → ["origin", "main"]; a base with no remote has nothing to fetch.
export function splitBase(base: string): { remote: string; branch: string } | null {
  const slash = base.indexOf('/')
  if (slash <= 0 || slash === base.length - 1) return null
  return { remote: base.slice(0, slash), branch: base.slice(slash + 1) }
}

// No prompt can reach a session's terminal: https asks for nothing, and ssh
// runs in batch mode unless the repo or the user set an ssh command of their own.
async function quietEnv(io: Io, repoRoot: string): Promise<Record<string, string>> {
  const own = await io.run(['git', 'config', '--get', 'core.sshCommand'], { cwd: repoRoot })
  const ssh: Record<string, string> = own.exitCode === 0 && own.stdout.trim() !== '' ? {} : { GIT_SSH_COMMAND: 'ssh -o BatchMode=yes' }
  return { GIT_TERMINAL_PROMPT: '0', ...ssh }
}

// Fetches origin's main alone. It writes no FETCH_HEAD, so a session's own
// fetch or pull in the same repository is not raced.
export async function fetchMain(io: Io, repoRoot: string, base: string): Promise<boolean> {
  const parts = splitBase(base)
  if (!parts) return false
  try {
    const env = await quietEnv(io, repoRoot)
    const argv = ['git', 'fetch', '--quiet', '--no-tags', '--no-write-fetch-head', parts.remote, parts.branch]
    const run = await io.run(argv, { cwd: repoRoot, env, timeoutMs: FETCH_TIMEOUT_MS })
    return run.exitCode === 0
  } catch {
    return false
  }
}

// When the previous record is older than the TTL, fetch now and say how it went.
export async function freshFetch(io: Io, repoRoot: string, base: string, previous: FetchRecord | undefined, now: number): Promise<FetchRecord> {
  if (previous && now - previous.tried < FETCH_TTL_MS) return previous
  const ok = await fetchMain(io, repoRoot, base)
  return { tried: now, ok, okAt: ok ? now : (previous?.okAt ?? null) }
}

// The local main against origin's, or null for a repository with no remote.
export async function readMainLine(io: Io, repoRoot: string, fetched: FetchRecord | undefined): Promise<MainLine | null> {
  try {
    const base = await baseOf(io, repoRoot)
    const parts = splitBase(base)
    if (!parts) return null
    const local = parts.branch
    const counts = await io.run(['git', 'rev-list', '--left-right', '--count', `${local}...${base}`], { cwd: repoRoot })
    const sides = counts.exitCode === 0 ? parseAheadBehind(counts.stdout) : null
    // Left is the local main, right origin's: "behind" in the parse is the left side.
    return {
      base,
      local,
      hasLocal: sides !== null,
      ahead: sides?.behind ?? 0,
      behind: sides?.ahead ?? 0,
      fetchedAt: fetched?.okAt ?? null,
      fetchFailed: fetched !== undefined && !fetched.ok,
    }
  } catch {
    return null
  }
}

export async function repoMainLine(io: Io, repoRoot: string, previous: FetchRecord | undefined, now: number): Promise<{ main: MainLine | null; fetch: FetchRecord | null }> {
  const base = await baseOf(io, repoRoot).catch(() => 'main')
  if (!splitBase(base)) return { main: null, fetch: null }
  const fetch = await freshFetch(io, repoRoot, base, previous, now)
  return { main: await readMainLine(io, repoRoot, fetch), fetch }
}
