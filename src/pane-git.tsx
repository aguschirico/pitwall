// The lower half of the pane, when a row's "Show git" is on: where that
// front's branch stands, its commits over main, the files it changed and what
// is left uncommitted. Files and subjects only: line diffs are for the editor.
import type { PanelRow } from '../types'
import type { Elements } from './pane-rows'

export function gitSection(els: Elements, row: PanelRow, onClose: () => void) {
  const { Box, Text, Button } = els
  const git = row.git
  if (!git) return null
  const base = git.base ?? 'main'
  return (
    <Box key="git-panel" flexDirection="column" borderStyle="round" paddingLeft={1}>
      <Box flexDirection="row">
        <Text bold color="suggestion">{`Git · ${row.title}   `}</Text>
        <Button key="git-close" plain onPress={onClose}>
          <Text dimColor>✕ Close</Text>
        </Button>
      </Box>
      {row.openPath && <Text dimColor>{row.openPath}</Text>}
      {row.summary !== '' && <Text>{row.summary}</Text>}
      {git.base !== null && <Text dimColor>{`Commits on top of ${base}:`}</Text>}
      {git.base !== null && git.commits.length === 0 && <Text dimColor>{'  none'}</Text>}
      {git.shared && git.unpushed > 0 && <Text dimColor>{`Not pushed yet: ${git.unpushed}`}</Text>}
      {git.commits.map(commit => (
        <Text>{`  ${commit.hash} ${commit.subject}`}</Text>
      ))}
      {git.base !== null && <Text dimColor>{`Files · +${git.added} −${git.removed}:`}</Text>}
      {git.files.map(file => (
        <Text>{`  ${file.path}  +${file.added} −${file.removed}`}</Text>
      ))}
      {git.more > 0 && <Text dimColor>{`  … ${git.more} more`}</Text>}
      <Text dimColor>{'Uncommitted:'}</Text>
      {git.dirtyFiles.length === 0 && <Text dimColor>{'  nothing'}</Text>}
      {git.dirtyFiles.map(path => (
        <Text>{`  ${path}`}</Text>
      ))}
      {git.dirty > git.dirtyFiles.length && <Text dimColor>{`  … ${git.dirty - git.dirtyFiles.length} more`}</Text>}
    </Box>
  )
}
