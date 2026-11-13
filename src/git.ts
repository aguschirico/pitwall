// Where a front's worktree stands against the repo's main line: which
// worktree it is, commits ahead and behind origin's main, the files its branch
// changed, and files left uncommitted. Files only, never line diffs: the
// details are for the editor.
import type { Io } from './registry'

export type FileChange = { path: string; added: number; removed: number }

export type Commit = { hash: string; subject: string }

export type GitInfo = {
  base: string | null
  ahead: number
  behind: number
  dirty: number
  files: FileChange[]
  // Optional: a snapshot an older panel wrote has neither.
  commits?: Commit[]
  dirtyFiles?: string[]
  // On a shared branch (main): commits on it that its upstream does not have.
  unpushed?: number
  // The session is on a shared branch (main, master...). A snapshot written
  // before this has none: there a null base meant the shared branch.
  shared?: boolean
  // The working tree the session runs in, its branch (HEAD when detached),
  // and whether it is the repo's main checkout rather than a linked worktree.
  where?: Worktree | null
}

export type Worktree = { path: string; head: string; mainCheckout: boolean }

const COMMITS_SHOWN = 20
const DIRTY_SHOWN = 10

export function parseAheadBehind(text: string): { behind: number; ahead: number } | null {
  const match = /^(\d+)\s+(\d+)\s*$/.exec(text.trim())
  if (!match) return null
  return { behind: Number(match[1]), ahead: Number(match[2]) }
}

// A binary file's numstat is "-": it counts as no lines.
export function parseNumstat(text: string): FileChange[] {
  return text
    .split('\n')
    .map(line => line.split('\t'))
    .filter((parts): parts is [string, string, string] => parts.length === 3 && parts[2] !== '')
    .map(([added, removed, path]) => ({ path, added: Number(added) || 0, removed: Number(removed) || 0 }))
}

export function parseCommits(text: string): Commit[] {
  return text
    .split('\n')
    .filter(line => line.includes('\t'))
    .map(line => {
      const [hash = '', ...subject] = line.split('\t')
      return { hash, subject: subject.join('\t') }
    })
}

// " M a.ts" → "a.ts"; a rename "R  old -> new" → "new".
export function dirtyPaths(porcelain: string): string[] {
  return porcelain
    .split('\n')
    .filter(line => line.trim() !== '')
    .map(line => {
      const path = line.slice(3)
      const arrow = path.indexOf(' -> ')
      return arrow === -1 ? path : path.slice(arrow + 4)
    })
}

export function countDirty(porcelain: string): number {
  return porcelain.split('\n').filter(line => line.trim() !== '').length
}

export function isShared(git: GitInfo): boolean {
  return git.shared ?? git.base === null
}

// `git rev-parse --path-format=absolute --show-toplevel --git-dir --git-common-dir --abbrev-ref HEAD`:
// a linked worktree has a git dir of its own, the main checkout shares the common one.
export function parseWorktree(text: string): Worktree | null {
  const [path, gitDir, commonDir, head] = text.split('\n').map(line => line.trim())
  if (!path || !gitDir || !commonDir || !head) return null
  return { path, head, mainCheckout: gitDir === commonDir }
}

async function worktreeOf(io: Io, cwd: string): Promise<Worktree | null> {
  const argv = ['git', 'rev-parse', '--path-format=absolute', '--show-toplevel', '--git-dir', '--git-common-dir', '--abbrev-ref', 'HEAD']
  const run = await io.run(argv, { cwd })
  return run.exitCode === 0 ? parseWorktree(run.stdout) : null
}

// origin's default branch when there is a remote (local main goes stale), else main.
export async function baseOf(io: Io, cwd: string): Promise<string> {
  const run = await io.run(['git', 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], { cwd })
  const ref = run.stdout.trim()
  return run.exitCode === 0 && ref !== '' ? ref : 'main'
}

async function branchChanges(io: Io, cwd: string): Promise<Pick<GitInfo, 'base' | 'ahead' | 'behind' | 'files' | 'commits'>> {
  const base = await baseOf(io, cwd)
  const [counts, numstat, log] = await Promise.all([
    io.run(['git', 'rev-list', '--left-right', '--count', `${base}...HEAD`], { cwd }),
    io.run(['git', 'diff', '--numstat', `${base}...HEAD`], { cwd }),
    io.run(['git', 'log', '--format=%h%x09%s', '-n', String(COMMITS_SHOWN), `${base}..HEAD`], { cwd }),
  ])
  const sides = counts.exitCode === 0 ? parseAheadBehind(counts.stdout) : null
  return {
    base,
    ahead: sides?.ahead ?? 0,
    behind: sides?.behind ?? 0,
    files: numstat.exitCode === 0 ? parseNumstat(numstat.stdout) : [],
    commits: log.exitCode === 0 ? parseCommits(log.stdout) : [],
  }
}

// A session on the shared main line can still hold commits nobody else has:
// the ones on top of its upstream. None when it has no upstream.
async function unpushedCount(io: Io, cwd: string): Promise<number> {
  const count = await io.run(['git', 'rev-list', '--count', '@{upstream}..HEAD'], { cwd })
  const unpushed = count.exitCode === 0 ? Number.parseInt(count.stdout.trim(), 10) : 0
  return Number.isFinite(unpushed) ? unpushed : 0
}

// `ownBranch` is false for a session on the shared main line: it is still
// measured against origin's main, and also against its own upstream.
export async function fetchGit(io: Io, cwd: string, ownBranch: boolean): Promise<GitInfo | null> {
  try {
    const status = await io.run(['git', 'status', '--porcelain'], { cwd })
    if (status.exitCode !== 0) return null
    const dirty = countDirty(status.stdout)
    const dirtyFiles = dirtyPaths(status.stdout).slice(0, DIRTY_SHOWN)
    const [changes, where, unpushed] = await Promise.all([
      branchChanges(io, cwd),
      worktreeOf(io, cwd),
      ownBranch ? Promise.resolve(undefined) : unpushedCount(io, cwd),
    ])
    return { ...changes, dirty, dirtyFiles, shared: !ownBranch, where, ...(unpushed === undefined ? {} : { unpushed }) }
  } catch {
    return null
  }
}
