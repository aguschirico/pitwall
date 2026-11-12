// What GitHub and git say about a front's branch: the PR chip for the panel,
// and whether a closed front's work is over (merged or branch deleted).
import type { Io } from './registry'

export type PrChip = {
  number: number
  state: 'OPEN' | 'MERGED' | 'CLOSED'
  checks: 'pass' | 'fail' | 'pending' | null
  reviewDecision: string | null
}

const PR_FIELDS = 'number,state,statusCheckRollup,reviewDecision'
const FAILED = new Set(['FAILURE', 'ERROR', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE'])
const PR_STATES: readonly string[] = ['OPEN', 'MERGED', 'CLOSED']

function field(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null ? Reflect.get(value, key) : undefined
}

// A CheckRun carries status + conclusion; a StatusContext carries state.
function checkOutcome(check: unknown): 'pass' | 'fail' | 'pending' {
  const state = field(check, 'state')
  const status = field(check, 'status')
  const conclusion = field(check, 'conclusion')
  const settled = typeof state === 'string' ? state : status === 'COMPLETED' ? conclusion : 'PENDING'
  if (typeof settled === 'string' && FAILED.has(settled)) return 'fail'
  if (settled === 'PENDING' || settled === 'EXPECTED' || settled === '' || settled === undefined) return 'pending'
  return 'pass'
}

function rollup(checks: unknown): PrChip['checks'] {
  if (!Array.isArray(checks) || checks.length === 0) return null
  const outcomes = checks.map(checkOutcome)
  if (outcomes.includes('fail')) return 'fail'
  return outcomes.includes('pending') ? 'pending' : 'pass'
}

function isPrState(value: unknown): value is PrChip['state'] {
  return typeof value === 'string' && PR_STATES.includes(value)
}

export function parsePrView(json: string): PrChip | null {
  let data: unknown
  try {
    data = JSON.parse(json)
  } catch {
    return null
  }
  const number = field(data, 'number')
  const state = field(data, 'state')
  if (typeof number !== 'number' || !isPrState(state)) return null
  const decision = field(data, 'reviewDecision')
  return {
    number,
    state,
    checks: rollup(field(data, 'statusCheckRollup')),
    reviewDecision: typeof decision === 'string' && decision !== '' ? decision : null,
  }
}

export async function fetchPr(io: Io, repoRoot: string, branch: string): Promise<PrChip | null> {
  try {
    const run = await io.run(['gh', 'pr', 'view', branch, '--json', PR_FIELDS], { cwd: repoRoot })
    return run.exitCode === 0 ? parsePrView(run.stdout) : null
  } catch {
    return null
  }
}

export async function branchGone(io: Io, repoRoot: string, branch: string): Promise<boolean> {
  const run = await io.run(['git', '-C', repoRoot, 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}`])
  return run.exitCode !== 0
}
