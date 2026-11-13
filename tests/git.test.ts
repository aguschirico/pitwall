import { expect, test } from 'claude-code/testing'

import { fetchGit, parseAheadBehind, parseCommits, parseNumstat, parseWorktree, countDirty, dirtyPaths } from '../src/git'
import type { Io } from '../src/registry'

type Ran = { exitCode: number; stdout: string }
const ok = (stdout: string): Ran => ({ exitCode: 0, stdout })
const fail: Ran = { exitCode: 1, stdout: '' }

function io(answer: (argv: readonly string[]) => Ran): Io & { calls: string[][] } {
  const calls: string[][] = []
  return {
    calls,
    list: async () => [],
    read: async () => '',
    run: async (argv, init) => {
      calls.push([...argv, `@${init?.cwd ?? ''}`])
      return answer(argv)
    },
  }
}

test('left-right counts read as behind then ahead', async () => {
  expect(parseAheadBehind('3\t4\n')).toEqual({ behind: 3, ahead: 4 })
  expect(parseAheadBehind('nonsense')).toBe(null)
})

test('numstat lines become files, binaries count as zero', async () => {
  expect(parseNumstat('182\t20\tserver/src/mcp/tools.ts\n-\t-\tlogo.png\n')).toEqual([
    { path: 'server/src/mcp/tools.ts', added: 182, removed: 20 },
    { path: 'logo.png', added: 0, removed: 0 },
  ])
})

test('dirty files are the porcelain lines', async () => {
  expect(countDirty(' M a.ts\n?? b.ts\n')).toBe(2)
  expect(countDirty('')).toBe(0)
})

const ANSWERS = (argv: readonly string[]): Ran => {
  if (argv.includes('symbolic-ref')) return ok('origin/main\n')
  if (argv.includes('rev-list')) return ok('3\t4\n')
  if (argv.includes('--numstat')) return ok('182\t20\tserver/src/mcp/tools.ts\n')
  if (argv.includes('status')) return ok(' M a.ts\n')
  if (argv.includes('log')) return ok('34f68cd\tfix(f4): keep code spans out\n')
  return fail
}

test('a worktree on its own branch reports ahead, behind, files and dirty against origin', async () => {
  const fake = io(ANSWERS)
  const info = await fetchGit(fake, '/repo/search', true)
  expect(info).toEqual({
    base: 'origin/main',
    ahead: 4,
    behind: 3,
    dirty: 1,
    files: [{ path: 'server/src/mcp/tools.ts', added: 182, removed: 20 }],
    commits: [{ hash: '34f68cd', subject: 'fix(f4): keep code spans out' }],
    dirtyFiles: ['a.ts'],
    shared: false,
    where: null,
  })
  expect(fake.calls.every(call => call.at(-1) === '@/repo/search')).toBe(true)
})

test('a session on the shared branch is still measured against origin, and against its upstream', async () => {
  const fake = io(argv => (argv.includes('@{upstream}..HEAD') ? ok('0\n') : ANSWERS(argv)))
  const info = await fetchGit(fake, '/repo', false)
  expect(info).toEqual({
    base: 'origin/main',
    ahead: 4,
    behind: 3,
    dirty: 1,
    files: [{ path: 'server/src/mcp/tools.ts', added: 182, removed: 20 }],
    commits: [{ hash: '34f68cd', subject: 'fix(f4): keep code spans out' }],
    dirtyFiles: ['a.ts'],
    shared: true,
    where: null,
    unpushed: 0,
  })
})

test('a repo with no origin compares against its local main', async () => {
  const fake = io(argv => (argv.includes('symbolic-ref') ? fail : ANSWERS(argv)))
  expect((await fetchGit(fake, '/repo/search', true))?.base).toBe('main')
})

test('a folder that is not a repo gives nothing', async () => {
  expect(await fetchGit(io(() => fail), '/tmp/x', true)).toBe(null)
})

test('log lines become commits', async () => {
  expect(parseCommits('34f68cd\tfix: a\na91c2e0\ttest: b\tc\n')).toEqual([
    { hash: '34f68cd', subject: 'fix: a' },
    { hash: 'a91c2e0', subject: 'test: b\tc' },
  ])
})

test('porcelain lines become paths, renames by their new name', async () => {
  expect(dirtyPaths(' M a.ts\n?? new dir/b.ts\nR  old.ts -> c.ts\n')).toEqual(['a.ts', 'new dir/b.ts', 'c.ts'])
})

test('a session on the shared main line counts the commits its upstream does not have', async () => {
  const fake = io(argv => {
    if (argv.includes('status')) return ok('')
    if (argv.includes('rev-list') && argv.includes('@{upstream}..HEAD')) return ok('4\n')
    return fail
  })
  const info = await fetchGit(fake, '/repo', false)
  expect(info?.unpushed).toBe(4)
  expect(info?.shared).toBe(true)
})

test('rev-parse tells the main checkout from a linked worktree', async () => {
  expect(parseWorktree('/repo\n/repo/.git\n/repo/.git\nmain\n')).toEqual({ path: '/repo', head: 'main', mainCheckout: true })
  expect(parseWorktree('/repo/.worktrees/x\n/repo/.git/worktrees/x\n/repo/.git\nfeat/x\n')).toEqual({
    path: '/repo/.worktrees/x',
    head: 'feat/x',
    mainCheckout: false,
  })
  expect(parseWorktree('')).toBe(null)
})

test('the worktree a session runs in is read in its own folder', async () => {
  const fake = io(argv => (argv.includes('--show-toplevel') ? ok('/repo/.worktrees/x\n/repo/.git/worktrees/x\n/repo/.git\nfeat/x\n') : ANSWERS(argv)))
  expect((await fetchGit(fake, '/repo/.worktrees/x', true))?.where).toEqual({ path: '/repo/.worktrees/x', head: 'feat/x', mainCheckout: false })
})

test('a shared branch with no upstream has nothing unpushed', async () => {
  const fake = io(argv => (argv.includes('status') ? ok('') : fail))
  const info = await fetchGit(fake, '/repo', false)
  expect(info?.unpushed).toBe(0)
  expect(info?.commits).toEqual([])
})
