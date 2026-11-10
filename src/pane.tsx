// The pane beside the coordinator's chat: waiting fronts first. It only draws
// what the coordinator stored in `view`; the open row lives in `selected`, the
// row whose git fills the lower half in `gitOpen`.
import { atom, read, update } from 'claude-code'
import type { Hook, On } from 'claude-code'

import type { PanelRow, PanelView } from '../types'
import { goToFront } from './focus'
import { gitSection } from './pane-git'
import { frontRow, type Elements, type RowActions } from './pane-rows'

type Engine = Parameters<Hook<'ui.render'>>[0]

export const PANE_ID = 'pitwall'
export const PANE_TITLE = 'Pitwall'

const EMPTY: PanelView = { waiting: [], running: [], paused: [] }
const DEFAULT_ROWS = 40

// Change a tag when its value's fields change: it declines what an earlier
// version stored, which outlives a reload.
const view = atom({ plugin: 'pitwall', key: 'view' } as const, EMPTY, { shape: 'view-5' })
const selected = atom({ plugin: 'pitwall', key: 'selected' } as const, null, { shape: 'selected-1' })
const gitOpen = atom({ plugin: 'pitwall', key: 'gitOpen' } as const, null, { shape: 'git-open-1' })

// The `code` command when it is on the PATH, else the macOS app by name.
const OPENERS = (path: string): string[][] => [
  ['code', path],
  ['open', '-a', 'Visual Studio Code', path],
]

async function openInEditor($: Engine, path: string): Promise<void> {
  for (const argv of OPENERS(path)) {
    const opened = await $.process.run(argv).then(
      run => run.exitCode === 0,
      () => false,
    )
    if (opened) return
  }
  await $.ui.toast("Could not open VS Code: install the `code` command (Shell Command: Install 'code' command in PATH).")
}

// The rows the pane has to draw in, from the Pane's props.
function bodyRows(e: unknown): number {
  const pick = (value: unknown, key: string): unknown =>
    typeof value === 'object' && value !== null ? Reflect.get(value, key) : undefined
  const rows = pick(pick(pick(e, 'props'), 'scroll'), 'bodyRows')
  return typeof rows === 'number' && rows > 0 ? rows : DEFAULT_ROWS
}

function allRows(panel: PanelView): PanelRow[] {
  return [...panel.waiting, ...panel.running, ...panel.paused]
}

async function drawPanel($: Engine, els: Elements, rows: number) {
  const { Box, Text } = els
  const panel = await read($, view)
  const open = await read($, selected)
  const gitId = await read($, gitOpen)
  const gitRow = allRows(panel).find(row => row.id === gitId)
  if (allRows(panel).length === 0) return <Text dimColor>Nothing open.</Text>
  const actions = (id: string): RowActions => ({
    onToggle: () => void update($, selected, current => (current === id ? null : id)),
    onToggleGit: () => void update($, gitOpen, current => (current === id ? null : id)),
    onOpenIde: path => void openInEditor($, path),
    onGo: () => void goToFront($, id).then(text => $.ui.toast(text)),
  })
  const draw = (row: PanelRow, lead: string, leadColor: string | undefined, dim: boolean) =>
    frontRow(els, row, { lead, leadColor, dim, isOpen: open === row.id, isGitOpen: gitRow?.id === row.id }, actions(row.id))
  const list = (
    <Box flexDirection="column" height={gitRow ? Math.floor(rows / 2) : undefined} overflow={gitRow ? 'hidden' : undefined}>
      <Text bold color="warning" dimColor={panel.waiting.length === 0}>{`Waiting on you · ${panel.waiting.length}`}</Text>
      {panel.waiting.map((row, index) => draw(row, `${index + 1} · ${row.tag ?? ''}`, 'warning', false))}
      <Text bold color="success">{`Running · ${panel.running.length}`}</Text>
      {panel.running.map(row => draw(row, '●', 'success', false))}
      <Text bold dimColor>{`Paused · ${panel.paused.length}`}</Text>
      {panel.paused.map(row => draw(row, '○', undefined, true))}
    </Box>
  )
  return (
    <Box flexDirection="column">
      {list}
      {gitRow && gitSection(els, gitRow, () => void update($, gitOpen, () => null))}
    </Box>
  )
}

// The coordinator's one way in: a state atom is only written in its own file.
export async function setView($: Parameters<Hook<'session.start'>>[0], next: PanelView): Promise<void> {
  await update($, view, () => next)
}

export function registerPane(on: On): void {
  on('ui.render', { component: 'Pane', requestId: PANE_ID }, async ($, e) => drawPanel($, $.ui.resolve(e), bodyRows(e)))
}
