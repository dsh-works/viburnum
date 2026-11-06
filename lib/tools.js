/**
 * The model-facing tools: the same core the page and the CLI call.
 *
 * Reads are free. Every move asks the approval service first (a tool that
 * writes outside the workspace needs the user's consent), and a refusal is
 * reported as a domain value, not as prose the model has to parse.
 *
 * @module viburnum/lib/tools
 */

/** One text content block. */
function text(value) {
  return [{ type: 'text', text: value }]
}

/** `↑2 ↓3`, or `✓`. */
function arrows(row) {
  const parts = []
  if ((row.ahead ?? 0) > 0) parts.push(`↑${row.ahead}`)
  if ((row.behind ?? 0) > 0) parts.push(`↓${row.behind}`)
  return parts.join(' ') || '✓'
}

/** A short human line for the status snapshot. */
function statusText(snapshot) {
  const lines = snapshot.rows.map(
    (row) => `${row.name} — ${row.track ?? '-'} ${arrows(row)} ${row.status}${row.stale ? ' (stale)' : ''}`,
  )
  if (lines.length === 0) lines.push('no linked bundles')
  lines.push(`dot: ${snapshot.dot}${snapshot.checkedAt ? ` · checked ${snapshot.checkedAt}` : ''}`)
  return lines.join('\n')
}

/** A compact canonical value for one action result. */
function summarize(result) {
  if (Array.isArray(result?.results)) {
    return {
      ok: result.ok,
      totals: result.totals,
      results: result.results.map((entry) => summarize(entry)),
    }
  }
  if (result?.dryRun === true) return { ok: result.ok === true, dryRun: true, plan: result.plan }
  if (result?.ok === false) {
    const value = { ok: false, code: result.code, message: result.message }
    if (Array.isArray(result.files)) value.files = result.files
    if (Array.isArray(result.published)) value.published = result.published
    if (result.track) value.track = result.track
    return value
  }
  const value = { ok: true }
  if (result?.name) value.bundle = result.name
  if (result?.nothing === true) value.nothing = true
  if (result?.receipt) value.receipt = result.receipt
  if (result?.reload) value.reload = result.reload
  return value
}

/** A short human line for one summarized action. */
function describe(value) {
  if (Array.isArray(value?.rows)) return statusText(value)
  if (Array.isArray(value?.results)) {
    const rows = value.results.map((entry) => describe(entry))
    return [...rows, `totals: pushed ${value.totals?.pushed ?? 0}, pulled ${value.totals?.pulled ?? 0}, rebased ${value.totals?.rebased ?? 0}`].join('\n')
  }
  if (value?.dryRun === true) {
    const plan = value.plan ?? {}
    const moves = [plan.pulled ? `↓${plan.pulled}` : null, plan.rebased ? `↑${plan.rebased}` : null].filter(Boolean)
    return `plan: ${plan.action}${moves.length ? ` ${moves.join(' ')}` : ''}`
  }
  if (value?.ok === false) return `refused: ${value.code} — ${value.message}`
  if (value?.nothing === true) return `${value.bundle ?? 'bundle'}: nothing to do`
  const receipt = value?.receipt
  if (receipt) {
    const numbers = [`pushed ${receipt.pushed}`, `pulled ${receipt.pulled}`, `rebased ${receipt.rebased}`]
    if (receipt.kind === 'switch' && receipt.track) numbers.unshift(`on ${receipt.track}`)
    return `${value.bundle ?? 'bundle'}: ${numbers.join(', ')}`
  }
  return JSON.stringify(value, null, 2)
}

/**
 * Ask the approval service for one move.
 *
 * @param {object} ctx - the Host context.
 * @param {{ agent?: object, callId?: string, signal?: AbortSignal }} exec - the tool run context.
 * @param {string} toolName - the tool name, for the audit log.
 * @param {string} reason - one sentence describing the move.
 * @returns {Promise<object | null>} null when approved, a refusal value otherwise.
 */
async function requireApproval(ctx, exec, toolName, reason) {
  const approval = ctx.get('approval')
  if (approval === undefined || approval === null || typeof approval.request !== 'function') {
    return { ok: false, code: 'approval-unavailable', message: 'the approval service is not available in this profile' }
  }
  const outcome = await approval.request({
    agent: exec.agent,
    toolName,
    callId: exec.callId,
    reason,
    signal: exec.signal,
  })
  if (outcome === 'allowed-once') return null
  return { ok: false, code: `approval-${outcome}`, message: `the move was not approved (${outcome})` }
}

/** Turn an exception into a canonical refusal value. */
function toolFailure(error) {
  return { ok: false, code: error.code ?? 'error', message: error.message }
}

/**
 * Build every tool definition. The caller registers each one inside an effect.
 *
 * @param {{ ctx: object, core: object, ready: Promise<Error | null> }} deps - the Host context, the core and its load promise.
 * @returns {Array<object>} tool definitions.
 */
export function buildTools({ ctx, core, ready }) {
  /** Wait for the core's state load, reporting a broken load as a refusal. */
  const waitReady = async () => {
    const error = await ready
    if (error) return { ok: false, code: 'not-ready', message: `Viburnum could not read its state: ${error.message}` }
    return null
  }

  return [
    {
      name: 'vib_status',
      description:
        'Read the cached state of the linked plugin checkouts: each bundle’s track, direction counts, status and the aggregate dot. Local read only; no network and no writes.',
      parameters: {},
      output: { schema: { type: 'object' }, render: (_args, value) => text(describe(value)) },
      async execute() {
        const failure = await waitReady()
        if (failure) return failure
        return core.snapshot()
      },
    },
    {
      name: 'vib_update',
      description:
        'Fast-forward one linked plugin checkout, or every mounted bundle when no bundle is named. Refuses anything but a fast-forward; records a receipt and a revert snapshot. Asks for approval.',
      parameters: {
        bundle: { type: 'string', description: 'Package name such as `dsh-plugin-pixelart`; omit for every mounted bundle' },
      },
      output: { schema: { type: 'object' }, render: (_args, value) => text(describe(value)) },
      async execute(args, exec) {
        const failure = await waitReady()
        if (failure) return failure
        const refused = await requireApproval(ctx, exec, 'vib_update', args.bundle ? `fast-forward ${args.bundle}` : 'fast-forward every mounted bundle')
        if (refused) return refused
        try {
          return summarize(await core.update(args.bundle ?? null))
        } catch (error) {
          return toolFailure(error)
        }
      },
    },
    {
      name: 'vib_sync',
      description:
        'Close the loop on one linked plugin checkout, or on every mounted bundle except Viburnum itself: fetch, push unpublished commits, fast-forward, or rebase private divergence and push. Refuses a rebase that would rewrite published history and aborts a conflicting rebase. Asks for approval unless dry_run is true.',
      parameters: {
        bundle: { type: 'string', description: 'Package name; omit for every mounted bundle' },
        dry_run: { type: 'boolean', description: 'Fetch and report the plan without moving the tree or pushing' },
      },
      output: { schema: { type: 'object' }, render: (_args, value) => text(describe(value)) },
      async execute(args, exec) {
        const failure = await waitReady()
        if (failure) return failure
        if (args.dry_run !== true) {
          const refused = await requireApproval(ctx, exec, 'vib_sync', args.bundle ? `sync ${args.bundle}` : 'sync every mounted bundle')
          if (refused) return refused
        }
        try {
          return summarize(await core.sync(args.bundle ?? null, { dryRun: args.dry_run === true }))
        } catch (error) {
          return toolFailure(error)
        }
      },
    },
    {
      name: 'vib_switch',
      description:
        'Switch one linked plugin checkout to another branch (its track): fetch, switch locally or create the tracking branch, then fast-forward when possible. Reports what the move implies for the running profile. Asks for approval.',
      parameters: {
        bundle: { type: 'string', required: true, description: 'Package name of the linked bundle' },
        track: { type: 'string', required: true, description: 'Branch name, for example `main` or `dev`' },
      },
      output: { schema: { type: 'object' }, render: (_args, value) => text(describe(value)) },
      async execute(args, exec) {
        const failure = await waitReady()
        if (failure) return failure
        const refused = await requireApproval(ctx, exec, 'vib_switch', `switch ${args.bundle} to ${args.track}`)
        if (refused) return refused
        try {
          return summarize(await core.switch(args.bundle, args.track))
        } catch (error) {
          return toolFailure(error)
        }
      },
    },
    {
      name: 'vib_revert',
      description:
        'Restore the latest update or switch snapshot recorded for one linked plugin checkout. Never touches a pushed rebase. Refuses a dirty tree. Asks for approval.',
      parameters: {
        bundle: { type: 'string', required: true, description: 'Package name of the linked bundle' },
      },
      output: { schema: { type: 'object' }, render: (_args, value) => text(describe(value)) },
      async execute(args, exec) {
        const failure = await waitReady()
        if (failure) return failure
        const refused = await requireApproval(ctx, exec, 'vib_revert', `restore the last snapshot of ${args.bundle}`)
        if (refused) return refused
        try {
          return summarize(await core.revert(args.bundle))
        } catch (error) {
          return toolFailure(error)
        }
      },
    },
  ]
}
