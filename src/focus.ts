// "go": brings a session's terminal to the front, on its own tab where the
// terminal lets a script pick one (by tty or by its remote control), else the
// terminal app alone. Approvals are answered there, so this is the way to them.
import { currentFronts } from './coordinator'
import { sessionWhere } from './format'
import { ioFrom, type Io } from './registry'
import { relayTarget } from './relay'
import type { TerminalInfo } from './report'
import type { Hook } from 'claude-code'

type Engine = Parameters<Hook<'session.start'>>[0]

// TERM_PROGRAM → the app `open -a` knows. Cursor says "vscode" too.
const APPS: Record<string, string> = {
  ghostty: 'Ghostty',
  'iTerm.app': 'iTerm',
  Apple_Terminal: 'Terminal',
  vscode: 'Visual Studio Code',
  WarpTerminal: 'Warp',
  WezTerm: 'WezTerm',
  kitty: 'kitty',
}

const BY_TTY: Record<string, (tty: string) => string> = {
  ghostty: tty => `tell application "Ghostty"
  repeat with w in windows
    repeat with tb in tabs of w
      repeat with t in terminals of tb
        if tty of t is "${tty}" then
          focus t
          activate
          return "focused"
        end if
      end repeat
    end repeat
  end repeat
end tell
error "not found"`,
  'iTerm.app': tty => `tell application "iTerm2"
  repeat with w in windows
    repeat with tb in tabs of w
      repeat with s in sessions of tb
        if tty of s is "${tty}" then
          select w
          select tb
          select s
          activate
          return "focused"
        end if
      end repeat
    end repeat
  end repeat
end tell
error "not found"`,
  Apple_Terminal: tty => `tell application "Terminal"
  repeat with w in windows
    repeat with tb in tabs of w
      if tty of tb is "${tty}" then
        set selected of tb to true
        set index of w to 1
        activate
        return "focused"
      end if
    end repeat
  end repeat
end tell
error "not found"`,
}

// "ttys012" → "/dev/ttys012"; "??" (no terminal) → null.
export function parseTty(text: string): string | null {
  const tty = text.trim()
  return tty === '' || tty.startsWith('?') ? null : `/dev/${tty}`
}

// The commands to try in order; the first that exits 0 has done it.
export function focusPlan(terminal: TerminalInfo, tty: string | null): string[][] {
  const program = terminal.program
  if (program === null || tty === null) return []
  const app = APPS[program]
  if (terminal.tmuxPane) return [['tmux', 'switch-client', '-t', terminal.tmuxPane], ...(app ? [['open', '-a', app]] : [])]
  if (terminal.kittyWindow) return [['kitten', '@', 'focus-window', '--match', `id:${terminal.kittyWindow}`]]
  if (terminal.weztermPane) return [['wezterm', 'cli', 'activate-pane', '--pane-id', terminal.weztermPane]]
  const script = BY_TTY[program]
  if (script) return [['osascript', '-e', script(tty)]]
  return app ? [['open', '-a', app]] : []
}

async function ttyOf(io: Io, pid: number): Promise<string | null> {
  const run = await io.run(['ps', '-o', 'tty=', '-p', String(pid)])
  return run.exitCode === 0 ? parseTty(run.stdout) : null
}

async function runFirst(io: Io, plan: string[][]): Promise<boolean> {
  for (const argv of plan) {
    const ran = await io.run(argv).catch(() => null)
    if (ran?.exitCode === 0) return true
  }
  return false
}

export async function goToFront($: Engine, frontId: string): Promise<string> {
  const front = currentFronts().find(one => one.id === frontId)
  const session = front ? relayTarget(front) : null
  if (!front || !session?.live) return 'That session is no longer open.'
  const io = ioFrom($)
  const plan = focusPlan(session.report.terminal ?? { program: null }, await ttyOf(io, session.live.pid))
  if (await runFirst(io, plan)) return `Taking you to ${session.live.name}.`
  return `Cannot bring that terminal forward: ${sessionWhere(session).replace(/^Session/, 'the session is')}.`
}
