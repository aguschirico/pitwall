import { expect, test } from 'claude-code/testing'

import { compareVersions, installedVersion, isBehind, manifestVersion } from '../src/version'

test('versions compare part by part, not as text', async () => {
  expect(compareVersions('0.1.9', '0.1.10')).toBeLessThan(0)
  expect(compareVersions('0.2.0', '0.1.22')).toBeGreaterThan(0)
  expect(compareVersions('0.1.22', '0.1.22')).toBe(0)
  expect(compareVersions('1.0', '1.0.0')).toBe(0)
})

test('a plugin.json gives its version, and anything else none', async () => {
  expect(manifestVersion('{"name":"pitwall","version":"0.1.23"}')).toBe('0.1.23')
  expect(manifestVersion('{"name":"pitwall"}')).toBe(null)
  expect(manifestVersion('{"version":"latest"}')).toBe(null)
  expect(manifestVersion('not json')).toBe(null)
})

test('the installed pitwall is the newest entry under its name, from any marketplace', async () => {
  const text = JSON.stringify({
    version: 2,
    plugins: {
      'pitwall@aguschirico': [{ scope: 'user', version: '0.1.22' }, { scope: 'project', version: '0.1.9' }],
      'pitwall@other': [{ scope: 'user', version: '0.1.23' }],
      'pitwall-extra@aguschirico': [{ scope: 'user', version: '9.0.0' }],
    },
  })
  expect(installedVersion(text)).toBe('0.1.23')
  expect(installedVersion(JSON.stringify({ version: 2, plugins: {} }))).toBe(null)
  expect(installedVersion('')).toBe(null)
})

test('a session is behind when it runs an older pitwall, or one too old to say', async () => {
  expect(isBehind('0.1.22', '0.1.23')).toBe(true)
  expect(isBehind(undefined, '0.1.23')).toBe(true)
  expect(isBehind(null, '0.1.23')).toBe(true)
  expect(isBehind('0.1.23', '0.1.23')).toBe(false)
  // A plugin folder in development runs ahead of the installed one.
  expect(isBehind('0.1.24', '0.1.23')).toBe(false)
  // Nothing installed to compare with: no session is told to restart.
  expect(isBehind('0.1.22', null)).toBe(false)
})
