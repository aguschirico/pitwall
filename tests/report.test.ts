import { expect, test } from 'claude-code/testing'

import { parseReport, reportPath, serializeReport, type Report } from '../src/report'

const REPORT: Report = {
  v: 1,
  sessionId: 'abc',
  cwd: '/repo',
  repoRoot: '/repo',
  branch: 'feat/x',
  title: 'Feature X',
  activity: 'Bash: pnpm test',
  state: 'waiting',
  waiting: {
    kind: 'decision',
    why: 'A o B',
    question: 'A or B?',
    options: ['A', 'B'],
    recap: 'tarea 3 hecha',
    since: 1000,
    classified: true,
  },
  updatedAt: 2000,
  lastMessage: 'A or B?',
  steps: ['Bash: ls'],
}

test('a serialized report parses back to itself', async () => {
  expect(parseReport(serializeReport(REPORT))).toEqual(REPORT)
})

test('a truncated report is rejected', async () => {
  expect(parseReport('{"v":1,"sessionId":')).toBe(null)
})

test('a report of another version is rejected', async () => {
  expect(parseReport(JSON.stringify({ ...REPORT, v: 2 }))).toBe(null)
})

test('a report without a state is rejected', async () => {
  const { state: _state, ...rest } = REPORT
  expect(parseReport(JSON.stringify(rest))).toBe(null)
})

test('a report with an unknown wait kind is rejected', async () => {
  const bad = { ...REPORT, waiting: { ...REPORT.waiting, kind: 'other' } }
  expect(parseReport(JSON.stringify(bad))).toBe(null)
})

test('the report path lives under the user claude folder', async () => {
  expect(reportPath('/h/.claude', 'abc')).toBe('/h/.claude/pitwall/reports/abc.json')
})

test('a report written before messages and steps were kept still parses', async () => {
  const { lastMessage: _m, steps: _s, ...older } = REPORT
  expect(parseReport(JSON.stringify(older))).toEqual({ ...REPORT, lastMessage: null, steps: [] })
})
