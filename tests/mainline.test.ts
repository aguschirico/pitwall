import { expect, test } from 'claude-code/testing'

import { FETCH_TTL_MS, freshFetch, readMainLine, repoMainLine, splitBase } from '../src/mainline'
import type { Io } from '../src/registry'

type Ran = { exitCode: number; stdout: string }
const ok = (stdout: string): Ran => ({ exitCode: 0, stdout })
const fail: Ran = { exitCode: 1, stdout: '' }
const NOW = 1_800_000_000_000

type Call = { argv: string[]; cwd: string; env: Record<string, string> }

function io(answer: (argv: readonly string[]) => Ran): Io & { calls: Call[] } {
  const calls: Call[] = []
  return {
    calls,
    list: async () => [],
    read: async () => '',
    run: async (argv, init) => {
      calls.push({ argv: [...argv], cwd: init?.cwd ?? '', env: init?.env ?? {} })
      return answer(argv)
    },
  }
}

const REPO = (argv: readonly string[]): Ran => {
  if (argv.includes('symbolic-ref')) return ok('origin/main\n')
  if (argv.includes('rev-list')) return ok('2\t5\n')
  if (argv.includes('fetch')) return ok('')
  return fail
}

test('a base splits into its remote and branch; a local one has no remote', async () => {
  expect(splitBase('origin/main')).toEqual({ remote: 'origin', branch: 'main' })
  expect(splitBase('upstream/release/2')).toEqual({ remote: 'upstream', branch: 'release/2' })
  expect(splitBase('main')).toBe(null)
})

test('local main reads as ahead and behind origin/main', async () => {
  const main = await readMainLine(io(REPO), '/repo', { tried: NOW, ok: true, okAt: NOW })
  expect(main).toEqual({ base: 'origin/main', local: 'main', hasLocal: true, ahead: 2, behind: 5, fetchedAt: NOW, fetchFailed: false })
})

test('a repository with no local main says so', async () => {
  const fake = io(argv => (argv.includes('rev-list') ? fail : REPO(argv)))
  expect((await readMainLine(fake, '/repo', undefined))?.hasLocal).toBe(false)
})

test('a repository with no remote has no main line and fetches nothing', async () => {
  const fake = io(argv => (argv.includes('symbolic-ref') ? fail : REPO(argv)))
  expect(await repoMainLine(fake, '/repo', undefined, NOW)).toEqual({ main: null, fetch: null })
  expect(fake.calls.some(call => call.argv.includes('fetch'))).toBe(false)
})

test('origin main is fetched alone, without prompts, and not again within the TTL', async () => {
  const fake = io(REPO)
  const first = await freshFetch(fake, '/repo', 'origin/main', undefined, NOW)
  expect(first).toEqual({ tried: NOW, ok: true, okAt: NOW })
  const fetch = fake.calls.find(call => call.argv.includes('fetch'))
  expect(fetch?.argv).toEqual(['git', 'fetch', '--quiet', '--no-tags', '--no-write-fetch-head', 'origin', 'main'])
  expect(fetch?.cwd).toBe('/repo')
  expect(fetch?.env).toEqual({ GIT_TERMINAL_PROMPT: '0', GIT_SSH_COMMAND: 'ssh -o BatchMode=yes' })

  const again = await freshFetch(fake, '/repo', 'origin/main', first, NOW + FETCH_TTL_MS - 1)
  expect(again).toBe(first)
  expect(fake.calls.filter(call => call.argv.includes('fetch')).length).toBe(1)
})

test('an ssh command the user set is left to run as theirs', async () => {
  const fake = io(argv => (argv.includes('core.sshCommand') ? ok('ssh -i ~/.ssh/work\n') : REPO(argv)))
  await freshFetch(fake, '/repo', 'origin/main', undefined, NOW)
  expect(fake.calls.find(call => call.argv.includes('fetch'))?.env).toEqual({ GIT_TERMINAL_PROMPT: '0' })
})

test('a failed fetch keeps when the last one worked', async () => {
  const fake = io(argv => (argv.includes('fetch') ? fail : REPO(argv)))
  const record = await freshFetch(fake, '/repo', 'origin/main', { tried: NOW - FETCH_TTL_MS, ok: true, okAt: NOW - FETCH_TTL_MS }, NOW)
  expect(record).toEqual({ tried: NOW, ok: false, okAt: NOW - FETCH_TTL_MS })
  const { main } = await repoMainLine(fake, '/repo', record, NOW + 1)
  expect(main?.fetchFailed).toBe(true)
  expect(main?.fetchedAt).toBe(NOW - FETCH_TTL_MS)
})
