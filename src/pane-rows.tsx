// One front in the pane. Closed: what, when, where it stands, what it waits
// for, and a line with its buttons. Open: what the session last said, its last steps and
// how to answer. No state here: the pane passes what is open and the actions.
import type { Hook } from 'claude-code'

import type { PanelRow } from '../types'

type Engine = Parameters<Hook<'ui.render'>>[0]
export type Elements = ReturnType<Engine['ui']['resolve']>

export type RowLook = { lead: string; leadColor: string | undefined; dim: boolean; isOpen: boolean; isGitOpen: boolean }
export type RowActions = {
  onToggle: () => void
  onToggleGit: () => void
  onOpenIde: (path: string) => void
  onGo: () => void
  onAnswer: () => void
}

// The session's last message drawn as the chat draws a reply (bold, lists,
// code), indented as a block, so a wrapped line keeps its indent.
function contextRows(els: Elements, row: PanelRow) {
  const { Box, Text, Markdown } = els
  return (
    <Box flexDirection="column">
      {row.message && <Text dimColor>{'    What the session said:'}</Text>}
      {row.message && (
        <Box paddingLeft={6}>
          <Markdown text={row.message} />
        </Box>
      )}
      {row.steps.length > 0 && <Text dimColor>{'    What it did before:'}</Text>}
      {row.steps.map(step => (
        <Text dimColor>{`      ${step}`}</Text>
      ))}
    </Box>
  )
}

// A question the coordinator can relay gets a button that starts the answer
// in the coordinator's prompt; an approval only says where to give it.
function answerRows(els: Elements, row: PanelRow, actions: RowActions) {
  const { Box, Text, Button } = els
  const drill = row.drill
  if (!drill) return null
  return (
    <Box flexDirection="column">
      {!row.message && <Text>{`    ${drill.question}`}</Text>}
      {drill.options.map((option, index) => (
        <Text>{`      ${index + 1}) ${option}`}</Text>
      ))}
      <Text dimColor>{`    ${drill.where}`}</Text>
      {drill.canRelay ? (
        <Box flexDirection="row">
          <Text>{'    '}</Text>
          <Button key={`answer:${row.id}`} plain onPress={actions.onAnswer}>
            <Text color="suggestion">{`✎ Answer here: /coordinate ${row.number} …`}</Text>
          </Button>
        </Box>
      ) : (
        <Text color="warning">{`    Approval: answer it in ${drill.where}`}</Text>
      )}
    </Box>
  )
}

// The row's actions on a line of their own, drawn open or closed, so a front
// waiting on an approval is one press from its session without opening it.
function buttonRow(els: Elements, row: PanelRow, look: RowLook, actions: RowActions) {
  const { Box, Text, Button } = els
  const sep = (show: boolean) => (show ? [<Text dimColor>{'   ·   '}</Text>] : [])
  const buttons = [
    ...(row.canGo
      ? [
          <Button key={`go:${row.id}`} plain onPress={actions.onGo} label="Go to session">
            <Text color="suggestion">↪ Go</Text>
          </Button>,
        ]
      : []),
    ...sep(row.canGo && (row.git !== null || row.openPath !== null)),
    ...(row.git
      ? [
          <Button key={`git:${row.id}`} plain onPress={actions.onToggleGit} label={look.isGitOpen ? 'Hide git' : 'Show git'}>
            <Text color="suggestion">{look.isGitOpen ? '▾ Git' : '▸ Git'}</Text>
          </Button>,
        ]
      : []),
    ...sep(row.git !== null && row.openPath !== null),
    ...(row.openPath
      ? [
          <Button key={`open:${row.id}`} plain onPress={() => actions.onOpenIde(row.openPath ?? '')} label="Open in VS Code">
            <Text color="suggestion">↗ Code</Text>
          </Button>,
        ]
      : []),
  ]
  return (
    <Box flexDirection="row" paddingLeft={4}>
      {buttons}
    </Box>
  )
}

export function frontRow(els: Elements, row: PanelRow, look: RowLook, actions: RowActions) {
  const { Box, Text, Button } = els
  return (
    <Box key={row.id} flexDirection="column">
      <Box flexDirection="row">
        <Text color={look.leadColor} dimColor={look.dim}>{`${look.lead} `}</Text>
        <Button key={row.id} plain dimColor={look.dim} onPress={actions.onToggle}>
          {row.title}
        </Button>
        <Text color={row.stuck ? 'warning' : undefined} bold={row.stuck} dimColor={!row.stuck}>{`  ${row.age}`}</Text>
      </Box>
      {row.summary !== '' && (
        <Box paddingLeft={4}>
          <Text color={row.git?.warn ? 'warning' : undefined} dimColor={!row.git?.warn}>{row.summary}</Text>
        </Box>
      )}
      {row.detail && (
        <Box paddingLeft={4}>
          <Text>{row.detail}</Text>
        </Box>
      )}
      {(row.canGo || row.git || row.openPath) && buttonRow(els, row, look, actions)}
      {look.isOpen && contextRows(els, row)}
      {look.isOpen && answerRows(els, row, actions)}
    </Box>
  )
}
