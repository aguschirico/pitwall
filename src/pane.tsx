// The pane beside the coordinator's chat: waiting fronts first. It only draws
// what the coordinator stored in `view`; the open row lives in `selected`, the
// row whose git fills the lower half in `gitOpen`.
import { atom, read, update } from 'claude-code'
import type { Hook, On } from 'claude-code'

import type { PanelRow, PanelView } from '../types'
import { drawnRows, repoParts } from './format'
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
const view = atom({ plugin: 'pitwall', key: 'view' } as const, EMPTY, { shape: 'view-6' })
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

type Draw = (row: PanelRow, lead: string, leadColor: string | undefined, dim: boolean) => ReturnType<typeof frontRow>

// The three sections for some of the rows, each row with its number on the
// whole panel. `showEmpty` draws a section with nothing in it, as the panel of
// one repository does; inside a repository only sections with rows show.
function sections(els: Elements, part: PanelView, numberOf: (row: PanelRow) => number, draw: Draw, showEmpty: boolean) {
  const { Text } = els
  const header = (rows: PanelRow[], text: string) => showEmpty || rows.length > 0 ? [text] : []
  return [
    ...header(part.waiting, `Waiting on you · ${part.waiting.length}`).map(text => (
      <Text bold color="warning" dimColor={part.waiting.length === 0}>{text}</Text>
    )),
    ...part.waiting.map(row => draw(row, `${numberOf(row)} · ${row.tag ?? ''}`, 'warning', false)),
    ...header(part.running, `Running · ${part.running.length}`).map(text => (
      <Text bold color="success">{text}</Text>
    )),
    ...part.running.map(row => draw(row, `${numberOf(row)} ●`, 'success', false)),
    ...header(part.paused, `Paused · ${part.paused.length}`).map(text => (
      <Text bold dimColor>{text}</Text>
    )),
    ...part.paused.map(row => draw(row, `${numberOf(row)} ○`, undefined, true)),
  ]
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
  const numbers = new Map(drawnRows(panel).map((row, index) => [row.id, index + 1]))
  const numberOf = (row: PanelRow) => numbers.get(row.id) ?? 0
  const repos = repoParts(panel)
  const body =
    repos.length === 0
      ? sections(els, panel, numberOf, draw, true)
      : repos.map(({ group, part }, index) => (
          <Box key={`repo:${group.label}`} flexDirection="column" marginTop={index === 0 ? 0 : 1}>
            <Text bold color={group.color}>{group.label}</Text>
            <Box flexDirection="column" paddingLeft={2}>
              {sections(els, part, numberOf, draw, false)}
            </Box>
          </Box>
        ))
  const list = (
    <Box flexDirection="column" height={gitRow ? Math.floor(rows / 2) : undefined} overflow={gitRow ? 'hidden' : undefined}>
      {body}
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
