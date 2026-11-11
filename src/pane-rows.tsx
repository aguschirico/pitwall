// One front in the pane. Closed: what, when, where it stands, what it waits
// for. Open: what the session last said, its last steps, how to answer, and
// the buttons. No state here: the pane passes what is open and the actions.
import type { Hook } from 'claude-code'

import type { PanelRow } from '../types'

type Engine = Parameters<Hook<'ui.render'>>[0]
export type Elements = ReturnType<Engine['ui']['resolve']>

export type RowLook = { lead: string; leadColor: string | undefined; dim: boolean; isOpen: boolean; isGitOpen: boolean }
export type RowActions = { onToggle: () => void; onToggleGit: () => void; onOpenIde: (path: string) => void; onGo: () => void }

function contextRows(els: Elements, row: PanelRow) {
  const { Box, Text } = els
  return (
    <Box flexDirection="column">
      {row.message && <Text dimColor>{'    What the session said:'}</Text>}
      {row.message?.split('\n').map(line => (
        <Text>{`    │ ${line}`}</Text>
      ))}
      {row.steps.length > 0 && <Text dimColor>{'    What it did before:'}</Text>}
      {row.steps.map(step => (
        <Text dimColor>{`      ${step}`}</Text>
      ))}
    </Box>
  )
}

function answerRows(els: Elements, row: PanelRow) {
  const { Box, Text } = els
  const drill = row.drill
  if (!drill) return null
  const answer = drill.canRelay ? `Answer here: "to ${row.title}: …"` : `Approval: answer it in ${drill.where}`
  return (
    <Box flexDirection="column">
      {!row.message && <Text>{`    ${drill.question}`}</Text>}
      {drill.options.map((option, index) => (
        <Text>{`      ${index + 1}) ${option}`}</Text>
      ))}
      <Text dimColor>{`    ${drill.where}`}</Text>
      <Text color={drill.canRelay ? 'suggestion' : 'warning'}>{`    ${answer}`}</Text>
    </Box>
  )
}

function buttonRow(els: Elements, row: PanelRow, look: RowLook, actions: RowActions) {
  const { Box, Text, Button } = els
  return (
    <Box flexDirection="row">
      <Text>{'    '}</Text>
      {row.canGo && (
        <Button key={`go:${row.id}`} plain onPress={actions.onGo}>
          <Text color="suggestion">↪ Go to session</Text>
        </Button>
      )}
      {row.canGo && (row.git || row.openPath) && <Text dimColor>{'   ·   '}</Text>}
      {row.git && (
        <Button key={`git:${row.id}`} plain onPress={actions.onToggleGit}>
          <Text color="suggestion">{look.isGitOpen ? '▸ Hide git' : '▸ Show git'}</Text>
        </Button>
      )}
      {row.git && row.openPath && <Text dimColor>{'   ·   '}</Text>}
      {row.openPath && (
        <Button key={`open:${row.id}`} plain onPress={() => actions.onOpenIde(row.openPath ?? '')}>
          <Text color="suggestion">↗ Open in VS Code</Text>
        </Button>
      )}
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
        <Text dimColor>{`  ${row.age}`}</Text>
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
      {look.isOpen && contextRows(els, row)}
      {look.isOpen && answerRows(els, row)}
      {look.isOpen && buttonRow(els, row, look, actions)}
    </Box>
  )
}
