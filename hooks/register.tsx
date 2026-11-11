import type { Register } from 'claude-code'

import { registerCoordinator, setRefreshMs, startCoordinator } from '../src/coordinator'
import { registerPane } from '../src/pane'
import { registerReporter, startReport } from '../src/reporter'
import { approvalCheckFrom, refreshMsFrom, setApprovalCheck } from '../src/settings'
import { registerToolHooks } from '../src/tools'

export const register: Register = (on, options) => {
  setRefreshMs(refreshMsFrom(options))
  setApprovalCheck(approvalCheckFrom(options))
  // The one session.start hook: the engine takes one per event per module.
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    // A -p run or an SDK host has nobody to wait on: it reports nothing.
    if (e.isInteractive) await startReport($, e.cwd)
    await startCoordinator($)
    return result
  })
  registerReporter(on)
  registerPane(on)
  registerCoordinator(on)
  registerToolHooks(on)
}
