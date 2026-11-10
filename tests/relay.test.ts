import { expect, test } from 'claude-code/testing'

import type { Front, FrontSession } from '../src/fronts'
import { planRelay } from '../src/relay'
import type { Waiting } from '../src/report'

const NOW = 1_000_000

function session(id: string, waiting: Waiting | null, isLive = true, updatedAt = NOW): FrontSession {
  return {
    report: {
      v: 1,
      sessionId: id,
      cwd: `/repo/.worktrees/${id}`,
      repoRoot: '/repo',
      branch: 'feat/x',
      title: null,
      activity: null,
      state: waiting ? 'waiting' : 'running',
      waiting,
      updatedAt,
    },
    live: isLive ? { sessionId: id, name: `s-${id}`, pid: 1, status: 'idle', cwd: '/repo', updatedAt } : null,
    reported: true,
  }
}

function front(sessions: FrontSession[]): Front {
  const waiting = sessions.find(one => one.report.waiting && one.live)?.report.waiting ?? null
  return {
    id: '/repo#feat/x',
    name: 'Search cache',
    section: waiting ? 'waiting' : 'running',
    sessions,
    waiting,
    activity: null,
    lastActivity: NOW,
    branch: 'feat/x',
    repoRoot: '/repo',
  }
}

const wait = (kind: Waiting['kind']): Waiting => ({ kind, why: 'w', question: 'q', options: [], recap: '', since: NOW, classified: true })

test('a front that does not exist is refused', async () => {
  expect(planRelay(undefined, 'sigue')).toEqual({ ok: false, reason: 'No such front.' })
})

test('a front with no open session is refused', async () => {
  expect(planRelay(front([session('a', null, false)]), 'sigue')).toEqual({
    ok: false,
    reason: 'Search cache has no open session.',
  })
})

test('an answer to a push request is refused and names the session', async () => {
  const plan = planRelay(front([session('a', wait('ok-push'))]), 'sí')
  expect(plan.ok).toBe(false)
  expect(plan.ok ? '' : plan.reason).toBe(
    'Not sent: that session waits for your OK to push, open a PR or merge, and that is answered there. Go to Session "s-a" (.worktrees/a).',
  )
})

test('an answer to a manual wait is refused', async () => {
  expect(planRelay(front([session('a', { ...wait('manual'), why: 'Permission: Bash ls' })]), 'listo').ok).toBe(false)
})

test('asking a deciding session to merge is refused', async () => {
  expect(planRelay(front([session('a', wait('decision'))]), 'haz merge y sigue').ok).toBe(false)
  expect(planRelay(front([session('a', null)]), 'dale push').ok).toBe(false)
})

test('a decision goes to the session that waits, wrapped as the user’s words', async () => {
  const plan = planRelay(front([session('a', null, true, NOW + 5), session('b', wait('decision'))]), 'elige B')
  expect(plan).toEqual({
    ok: true,
    sessionId: 'b',
    message: 'Relayed from the coordinator by the user: "elige B"',
  })
})

test('with nobody waiting the newest open session gets it', async () => {
  const plan = planRelay(front([session('a', null, true, NOW), session('b', null, true, NOW + 9)]), 'investiga el 500')
  expect(plan.ok ? plan.sessionId : '').toBe('b')
})

test('a wait only the fallback described is never relayed', async () => {
  expect(planRelay(front([session('a', { ...wait('review'), classified: false })]), 'sí').ok).toBe(false)
})

test('a plain yes to a wait the classifier read as a push request is refused', async () => {
  const asksPush = { ...wait('ok-push'), question: '¿Hago push de los 4 commits?' }
  expect(planRelay(front([session('a', asksPush)]), 'sí').ok).toBe(false)
})

test('a decision whose question only mentions push is answered like any decision', async () => {
  const mentions = { ...wait('decision'), question: '¿Bloqueamos también push y merge en el filtro, o solo deploy?' }
  expect(planRelay(front([session('a', mentions)]), 'solo deploy').ok).toBe(false)
  expect(planRelay(front([session('a', mentions)]), 'la primera').ok).toBe(true)
})

test('a refused text says which word stopped it', async () => {
  const plan = planRelay(front([session('a', null)]), 'ya está, haz merge cuando puedas')
  expect(plan.ok ? '' : plan.reason).toBe(
    'Not sent: your message says "merge", and push, PR, merge, deploy or prod never travel through the panel. Say it in Session "s-a" (.worktrees/a).',
  )
})

test('an open permission dialog cannot be answered from the panel', async () => {
  const dialog = { ...wait('manual'), why: 'Permission: Bash git status', question: 'Permission: Bash git status' }
  const plan = planRelay(front([session('a', dialog)]), 'sí')
  expect(plan.ok ? '' : plan.reason).toBe(
    'Not sent: that session has a permission dialog open, and that is answered there. Go to Session "s-a" (.worktrees/a).',
  )
})

test('telling a session that a manual task is done goes through', async () => {
  const task = { ...wait('manual'), why: 'Ejecuta /reload-plugins en el coordinador', question: '' }
  expect(planRelay(front([session('a', task)]), 'recargado').ok).toBe(true)
})

test('approvals in other words are refused', async () => {
  for (const text of [
    'sube los cambios a main',
    'súbelo',
    'abre la pull request',
    'haz el despliegue',
    'despliégalo',
    'ejecuta la migración en prod',
    'corre el SQL en producción',
    'ship it',
  ]) {
    expect(planRelay(front([session('a', null)]), text).ok, text).toBe(false)
  }
})

test('ordinary instructions still go through', async () => {
  for (const text of ['elige B', 'investiga el 500', 'prueba otra vez', 'sigue con la tarea 4', 'usa la primera opción']) {
    expect(planRelay(front([session('a', null)]), text).ok, text).toBe(true)
  }
})

test('approvals written in English are refused too', async () => {
  for (const text of [
    'push the branch',
    'open a pull request',
    'merge it when green',
    'deploy to staging',
    'run the migration in production',
    'cut a release',
  ]) {
    expect(planRelay(front([session('a', null)]), text).ok, text).toBe(false)
  }
})

test('ordinary English instructions still go through', async () => {
  for (const text of ['pick B', 'look into the 500', 'try again', 'go on with task 4', 'use the first option']) {
    expect(planRelay(front([session('a', null)]), text).ok, text).toBe(true)
  }
})

test('an English reply to a pending approval is refused', async () => {
  const asksPush = { ...wait('ok-push'), question: 'Shall I push?' }
  for (const text of ['yes', 'sure, go ahead', 'sounds good, but first rerun the tests and then carry on', 'proceed']) {
    expect(planRelay(front([session('a', asksPush)]), text).ok, text).toBe(false)
  }
})

test('with two waiting sessions the answer goes to the one shown, the oldest', async () => {
  const older = { ...wait('decision'), since: NOW - 9_000 }
  const newer = { ...wait('decision'), since: NOW - 1_000 }
  const sessions = [session('a', newer), session('b', older)]
  const plan = planRelay({ ...front(sessions), waiting: older }, 'elige B')
  expect(plan.ok ? plan.sessionId : '').toBe('b')
})

test('a session without the mod says so instead of calling it an approval', async () => {
  const unreported = { ...session('a', { ...wait('review'), classified: false }), reported: false }
  const plan = planRelay(front([unreported]), 'mira esto')
  expect(plan.ok ? '' : plan.reason).toBe(
    'That session does not have the mod loaded, so what it asks is unknown: answer it in Session "s-a" (.worktrees/a), or run /reload-plugins there.',
  )
})

test('a wait still being classified asks to try again in a moment', async () => {
  const plan = planRelay(front([session('a', { ...wait('review'), classified: false })]), 'mira esto')
  expect(plan.ok ? '' : plan.reason).toBe(
    'Still reading what that session asks: try again in a few seconds or answer it in Session "s-a" (.worktrees/a).',
  )
})

test('a new instruction to a session waiting on an approval goes through, marked as not answering it', async () => {
  const asksPush = { ...wait('ok-push'), question: '¿Hago push de los 4 commits?' }
  const text = 'ya tengo el panel, queremos ver cómo mejorarlo con una ventana de worktrees y un diff abajo'
  const plan = planRelay(front([session('a', asksPush)]), text)
  expect(plan).toEqual({
    ok: true,
    sessionId: 'a',
    message:
      `Relayed from the coordinator by the user: "${text}". ` +
      'This does not answer the approval you are waiting on: that one is given in this session.',
  })
  expect(planRelay(front([session('a', { ...wait('manual'), why: 'Permission: Bash ls' })]), text).ok).toBe(true)
})

test('anything that reads as an answer to a pending approval is still refused', async () => {
  const asksPush = { ...wait('ok-push'), question: 'Shall I push?' }
  for (const text of ['dale', 'ok, adelante', 'sí, pero antes revisa los tests y sigue con lo demás', 'no', 'hazlo ya mismo por favor', 'perfecto']) {
    expect(planRelay(front([session('a', asksPush)]), text).ok, text).toBe(false)
  }
})


test('approving a design is a decision, not an approval that must stay in the session', async () => {
  const design = {
    ...wait('decision'),
    why: 'Aprobar el diseño del panel tal cual o pedir cambios antes del plan de implementación.',
    question: '¿Lo apruebas así o cambio algo?',
    options: ['Aprobar el diseño tal cual', 'Cambiar algo del diseño'],
  }
  expect(planRelay(front([session('a', design)]), 'apruébalo tal cual').ok).toBe(true)
  expect(planRelay(front([session('a', design)]), 'sí').ok).toBe(true)
})

test('a summary that only mentions push or merge does not make the wait an approval', async () => {
  const talksAboutIt = {
    ...wait('review'),
    why: 'Revisar si tu texto llevaba push, commit, merge o PR, que el filtro bloquea',
    question: '',
    options: [],
  }
  expect(planRelay(front([session('a', talksAboutIt)]), 'ya lo envié').ok).toBe(true)
})
