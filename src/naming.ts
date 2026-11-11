// Renames a session after the work it is on, with the engine's own /rename,
// unless the user named it: a name this mod did not give is left alone.
// Sessions message each other by name, so a name another session already has
// is never given: the messages for one would reach the other.
import type { Hook } from 'claude-code'

type Engine = Parameters<Hook<'session.start'>>[0]

type RegistryName = { sessionId: string; name: string; nameSource: string }

async function registryNames($: Engine, claudeHome: string): Promise<RegistryName[]> {
  const dir = `${claudeHome}/sessions`
  const names: RegistryName[] = []
  for (const entry of await $.fs.list(dir)) {
    if (!entry.name.endsWith('.json')) continue
    const data: unknown = JSON.parse(await $.fs.read(`${dir}/${entry.name}`))
    const pick = (key: string): unknown => (typeof data === 'object' && data !== null ? Reflect.get(data, key) : undefined)
    const [id, name, source] = [pick('sessionId'), pick('name'), pick('nameSource')]
    if (typeof id === 'string' && typeof name === 'string') {
      names.push({ sessionId: id, name, nameSource: typeof source === 'string' ? source : '' })
    }
  }
  return names
}

const sameName = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase()

// Whether `name` may be given to this session now: not when the user named
// it (a /rename this mod did not do), and not when another session has it.
export async function mayRename($: Engine, claudeHome: string, sessionId: string, autoName: string | null, name: string): Promise<boolean> {
  try {
    const names = await registryNames($, claudeHome)
    const own = names.find(one => one.sessionId === sessionId)
    if (own && own.nameSource === 'user' && own.name !== autoName) return false
    return !names.some(one => one.sessionId !== sessionId && sameName(one.name, name))
  } catch {
    return false // unreadable registry: leave the name alone
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
