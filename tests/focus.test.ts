import { expect, test } from 'claude-code/testing'

import { focusPlan, parseTty } from '../src/focus'

const TTY = '/dev/ttys012'

test('ps output becomes a device path', async () => {
  expect(parseTty('ttys012\n')).toBe('/dev/ttys012')
  expect(parseTty('??\n')).toBe(null)
  expect(parseTty('')).toBe(null)
})

test('ghostty is focused by tty through its AppleScript', async () => {
  const [step] = focusPlan({ program: 'ghostty' }, TTY)
  expect(step?.[0]).toBe('osascript')
  expect(step?.join(' ').includes('application "Ghostty"')).toBe(true)
  expect(step?.join(' ').includes(TTY)).toBe(true)
})

test('iTerm2 and Terminal.app are focused by tty too', async () => {
  expect(focusPlan({ program: 'iTerm.app' }, TTY)[0]?.join(' ').includes('application "iTerm2"')).toBe(true)
  expect(focusPlan({ program: 'Apple_Terminal' }, TTY)[0]?.join(' ').includes('application "Terminal"')).toBe(true)
})

test('tmux switches to the pane, then brings its terminal forward', async () => {
  const plan = focusPlan({ program: 'ghostty', tmuxPane: '%7' }, TTY)
  expect(plan[0]).toEqual(['tmux', 'switch-client', '-t', '%7'])
  expect(plan[1]).toEqual(['open', '-a', 'Ghostty'])
})

test('kitty and WezTerm use their remote control', async () => {
  expect(focusPlan({ program: 'kitty', kittyWindow: '3' }, TTY)[0]).toEqual(['kitten', '@', 'focus-window', '--match', 'id:3'])
  expect(focusPlan({ program: 'WezTerm', weztermPane: '5' }, TTY)[0]).toEqual(['wezterm', 'cli', 'activate-pane', '--pane-id', '5'])
})

test('VS Code and Warp are brought forward, no tab can be picked', async () => {
  expect(focusPlan({ program: 'vscode' }, TTY)).toEqual([['open', '-a', 'Visual Studio Code']])
  expect(focusPlan({ program: 'WarpTerminal' }, TTY)).toEqual([['open', '-a', 'Warp']])
})

test('an unknown terminal has no way in', async () => {
  expect(focusPlan({ program: null }, TTY)).toEqual([])
  expect(focusPlan({ program: 'ghostty' }, null)).toEqual([])
})
