import { expect, test } from 'claude-code/testing'

import { claudeHomeFrom } from '../src/paths'

test('the Claude folder is ~/.claude by default', async () => {
  expect(claudeHomeFrom('/h', undefined)).toBe('/h/.claude')
})

test('CLAUDE_CONFIG_DIR moves the Claude folder, and this mod with it', async () => {
  expect(claudeHomeFrom('/h', '/demo/config/')).toBe('/demo/config')
})

test('a blank CLAUDE_CONFIG_DIR is ignored', async () => {
  expect(claudeHomeFrom('/h', '  ')).toBe('/h/.claude')
})
