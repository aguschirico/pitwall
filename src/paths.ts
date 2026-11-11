// Where Claude Code keeps its sessions registry and transcripts: the folder
// CLAUDE_CONFIG_DIR names when it is set, else ~/.claude. This mod keeps its
// reports and snapshot there too, so a session run under another config only
// ever sees the sessions of that config.
import type { Hook } from 'claude-code'

type Engine = Parameters<Hook<'session.start'>>[0]

export function claudeHomeFrom(home: string | undefined, configDir: string | undefined): string | null {
  const configured = configDir?.trim()
  if (configured) return configured.replace(/\/+$/, '')
  return home ? `${home}/.claude` : null
}

export async function claudeHomeOf($: Engine): Promise<string | null> {
  return claudeHomeFrom(await $.env.get('HOME'), await $.env.get('CLAUDE_CONFIG_DIR'))
}
