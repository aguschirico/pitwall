import { expect, test } from 'claude-code/testing'

import { branchGone, fetchPr, parsePrView } from '../src/pr'
import type { Io } from '../src/registry'

const run = (check: (argv: readonly string[], cwd?: string) => { exitCode: number; stdout: string }): Io => ({
  list: async () => [],
  read: async () => '',
  run: async (argv, init) => check(argv, init?.cwd),
})

const VIEW = (checks: unknown[], extra: Record<string, unknown> = {}) =>
  JSON.stringify({ number: 117, state: 'OPEN', reviewDecision: null, statusCheckRollup: checks, ...extra })

const DONE = (conclusion: string) => ({ __typename: 'CheckRun', status: 'COMPLETED', conclusion })

test('green checks read as pass', async () => {
  expect(parsePrView(VIEW([DONE('SUCCESS'), DONE('SKIPPED')]))?.checks).toBe('pass')
})

test('one failed check reads as fail', async () => {
  expect(parsePrView(VIEW([DONE('SUCCESS'), DONE('FAILURE')]))?.checks).toBe('fail')
})

test('a running check or a pending status reads as pending', async () => {
  expect(parsePrView(VIEW([DONE('SUCCESS'), { __typename: 'CheckRun', status: 'IN_PROGRESS', conclusion: '' }]))?.checks).toBe('pending')
  expect(parsePrView(VIEW([{ __typename: 'StatusContext', state: 'PENDING' }]))?.checks).toBe('pending')
})

test('no checks read as none', async () => {
  expect(parsePrView(VIEW([]))?.checks).toBe(null)
})

test('something that is not a pr view reads as nothing', async () => {
  expect(parsePrView('{}')).toBe(null)
  expect(parsePrView('not json')).toBe(null)
})

test('the pr is looked up from the repo folder', async () => {
  const seen: (string | undefined)[] = []
  const io = run((argv, cwd) => {
    seen.push(cwd)
    return { exitCode: 0, stdout: VIEW([DONE('SUCCESS')]) }
  })
  expect((await fetchPr(io, '/repo', 'feat/x'))?.number).toBe(117)
  expect(seen).toEqual(['/repo'])
})

test('no gh or no pr gives no chip', async () => {
  const io = run(() => ({ exitCode: 1, stdout: '' }))
  expect(await fetchPr(io, '/repo', 'feat/x')).toBe(null)
})

test('a branch git no longer knows is gone', async () => {
  expect(await branchGone(run(() => ({ exitCode: 1, stdout: '' })), '/repo', 'feat/x')).toBe(true)
  expect(await branchGone(run(() => ({ exitCode: 0, stdout: 'abc\n' })), '/repo', 'feat/x')).toBe(false)
})
