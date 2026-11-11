import { expect, test } from 'claude-code/testing'

import { approvalCheckFrom, notifyStuckFrom, refreshMsFrom, stuckMsFrom } from '../src/settings'

test('no refresh interval set means 5 seconds', async () => {
  expect(refreshMsFrom({})).toBe(5_000)
})

test('a refresh interval is held to 2..120 seconds', async () => {
  expect(refreshMsFrom({ refreshSeconds: 10 })).toBe(10_000)
  expect(refreshMsFrom({ refreshSeconds: 1 })).toBe(2_000)
  expect(refreshMsFrom({ refreshSeconds: 600 })).toBe(120_000)
  expect(refreshMsFrom({ refreshSeconds: '15' })).toBe(15_000)
})

test('a refresh interval that is not a number falls back to 5 seconds', async () => {
  expect(refreshMsFrom({ refreshSeconds: 'soon' })).toBe(5_000)
  expect(refreshMsFrom({ refreshSeconds: true })).toBe(5_000)
  expect(refreshMsFrom({ refreshSeconds: '' })).toBe(5_000)
})

test('the approval check is drafted by default, and takes only its three values', async () => {
  expect(approvalCheckFrom({})).toBe('drafted')
  expect(approvalCheckFrom({ approvalCheck: 'strict' })).toBe('strict')
  expect(approvalCheckFrom({ approvalCheck: 'off' })).toBe('off')
  expect(approvalCheckFrom({ approvalCheck: 'loose' })).toBe('drafted')
  expect(approvalCheckFrom({ approvalCheck: 3 })).toBe('drafted')
})

test('a wait is stuck after 5 minutes unless the user set another threshold', async () => {
  expect(stuckMsFrom({})).toBe(300_000)
  expect(stuckMsFrom({ stuckMinutes: 10 })).toBe(600_000)
  expect(stuckMsFrom({ stuckMinutes: '2' })).toBe(120_000)
  expect(stuckMsFrom({ stuckMinutes: 'later' })).toBe(300_000)
  expect(stuckMsFrom({ stuckMinutes: 99_999 })).toBe(86_400_000)
})

test('a stuck threshold of 0 turns the badge off', async () => {
  expect(stuckMsFrom({ stuckMinutes: 0 })).toBe(null)
  expect(stuckMsFrom({ stuckMinutes: -3 })).toBe(null)
})

test('the stuck notification is on unless the user turned it off', async () => {
  expect(notifyStuckFrom({})).toBe(true)
  expect(notifyStuckFrom({ stuckNotify: true })).toBe(true)
  expect(notifyStuckFrom({ stuckNotify: false })).toBe(false)
  expect(notifyStuckFrom({ stuckNotify: 'false' })).toBe(false)
})
