import { expect, test } from 'claude-code/testing'

import { PANE_ID } from '../src/pane'

const PANE = {
  plugin: 'pitwall',
  component: 'Pane',
  requestId: PANE_ID,
  props: {
    title: 'Sesiones',
    isFocused: false,
    bodyColumns: 80,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

// Pane tests with data run through /panel and a refresh: tests/coordinator.test.tsx.

test('an empty panel says nothing is open', async $ => {
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /Nothing open/ })).toBeDefined()
  await ui.unmount()
})
