// Renames a session after the work it is on, with the engine's own /rename,
// unless the user named it: a name this mod did not give is left alone.
import type { Hook } from 'claude-code'

type Engine = Parameters<Hook<'session.start'>>[0]

type RegistryName = { name: string; nameSource: string }

async function registryName($: Engine, home: string, sessionId: string): Promise<RegistryName | null> {
  const dir = `${home}/.claude/sessions`
  for (const entry of await $.fs.list(dir)) {
    if (!entry.name.endsWith('.json')) continue
    const data: unknown = JSON.parse(await $.fs.read(`${dir}/${entry.name}`))
    const pick = (key: string): unknown => (typeof data === 'object' && data !== null ? Reflect.get(data, key) : undefined)
    const [id, name, source] = [pick('sessionId'), pick('name'), pick('nameSource')]
    if (id === sessionId && typeof name === 'string') return { name, nameSource: typeof source === 'string' ? source : '' }
  }
  return null
}

// True when the user gave the session its name: a /rename this mod did not do.
export async function isUserNamed($: Engine, home: string, sessionId: string, autoName: string | null): Promise<boolean> {
  try {
    const found = await registryName($, home, sessionId)
    return found !== null && found.nameSource === 'user' && found.name !== autoName
  } catch {
    return true // unreadable registry: leave the name alone
  }
}

export async function renameSession($: Engine, name: string): Promise<boolean> {
  try {
    await $.command.run({ command: 'rename', args: name })
    return true
  } catch {
    return false
  }
}
