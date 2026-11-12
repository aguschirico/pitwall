// The values this mod keeps in $.state: the panel as the coordinator last
// built it, already in words, and the row opened in the pane.
export type PanelDrill = {
  question: string
  options: string[]
  recap: string
  where: string
  canRelay: boolean
}

export type PanelFile = { path: string; added: number; removed: number }

// Where the front's worktree stands; `chip` is null on the shared main line.
export type PanelCommit = { hash: string; subject: string }

export type PanelGit = {
  chip: string | null
  warn: boolean
  dirty: number
  base: string | null
  files: PanelFile[]
  more: number
  added: number
  removed: number
  commits: PanelCommit[]
  dirtyFiles: string[]
  // On a shared branch: commits its upstream does not have yet.
  unpushed: number
}

// The repository a row belongs to, when the panel shows more than one: its
// folder name and the color its header is drawn in.
export type PanelGroup = { label: string; color: string }

export type PanelRow = {
  id: string
  // The row's number for /coordinate: kept while the front is on the panel.
  number: number
  group: PanelGroup | null
  tag: string | null
  title: string
  age: string
  // Waiting on the user for longer than their threshold: the age is a badge.
  stuck: boolean
  summary: string
  detail: string | null
  activity: string | null
  // What the session last said and its last steps: the context an open row shows.
  message: string | null
  steps: string[]
  drill: PanelDrill | null
  git: PanelGit | null
  openPath: string | null
  // An open session to take the user to.
  canGo: boolean
  // No session is open: the row can be closed off the panel.
  canClose: boolean
}

export type PanelView = { waiting: PanelRow[]; running: PanelRow[]; idle: PanelRow[]; closed: PanelRow[] }

export type Selected = string | null

declare module 'claude-code' {
  interface PluginState {
    'pitwall': {
      view: Shaped<PanelView>
      selected: Shaped<Selected>
      gitOpen: Shaped<Selected>
      coordinator: Shaped<boolean>
    }
  }
}
