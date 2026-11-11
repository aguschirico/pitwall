import { expect, test } from 'claude-code/testing'

import { refreshMsFrom } from '../src/settings'

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
