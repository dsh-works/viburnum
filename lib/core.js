/**
 * The in-process core: one owner of the profile's bundles, their tracks, the
 * cached check rows, the state file, and the per-bundle action queue.
 *
 * The Host tools, the Web route and the CLI all call the same core. Nothing is
 * global: the instance is created by the Host entry or by the CLI process and
 * dies with it.
 *
 * @module viburnum/lib/core
 */

import { resolveConfig } from './config.js'
import { dotFor, aggregateDot, checkAll, trackChoices } from './status.js'
import {
  appendHistory,
  appendSnapshot,
  defaultState,
  loadState,
  prune,
  saveState,
  stateDir,
  upsertBundle,
} from './state.js'
import { revertBundle, syncAll, syncBundle, switchBundle, updateBundle } from './sync.js'

/** The package name of Viburnum itself; `Sync all` skips its own row (D12). */
export const OWN_PACKAGE = 'dsh-plugin-viburnum'

/** One typed failure for callers that want a code, not a parsed message. */
export function coreError(code, message) {
  const error = new Error(message)
  error.name = 'ViburnumError'
  error.code = code
  return error
}

/**
 * Create one core instance.
 *
 * @param {object} options - the core's collaborators.
 * @param {(context: { env: NodeJS.ProcessEnv, argv: string[] }) => Promise<{ profileDir: string, bundles: Array<object> }>} options.bundleSource - reads the mounted linked bundles.
 * @param {object} [options.config] - resolved or raw row configuration.
 * @param {NodeJS.ProcessEnv} [options.env] - environment (state path, profile).
 * @param {string[]} [options.argv] - process arguments (profile flag).
 * @param {() => Date} [options.now] - clock injection.
 * @param {{ warn?: Function, info?: Function }} [options.log] - optional logger.
 * @returns {object} the core.
 */
export function createCore({
  bundleSource,
  config,
  env = process.env,
  argv = process.argv,
  now = () => new Date(),
  log = null,
} = {}) {
  if (typeof bundleSource !== 'function') throw new Error('dsh-plugin-viburnum: createCore needs a bundleSource')
  if (typeof config === 'function') throw new Error('dsh-plugin-viburnum: pass configuration values, not a factory')

  const resolved = resolveConfig(config)
  const stateDirectory = stateDir({ env })
  const queues = new Map()

  let state = defaultState()
  let rows = []
  let checkedAt = null
  let refreshing = null
  let writes = Promise.resolve()

  const at = () => now().toISOString()
  const trackOf = (name) => state.bundles[name]?.track ?? null

  /** Serialize one bundle's moves; the queue never rejects. */
  const exclusive = (name, task) => {
    const previous = queues.get(name) ?? Promise.resolve()
    const run = previous.then(task, task)
    queues.set(name, run.then(() => undefined, () => undefined))
    return run
  }

  /** Serialize state writes: the last writer wins, and every writer waits. */
  const commit = () => {
    writes = writes.then(
      () => saveState(stateDirectory, prune(state)),
      () => saveState(stateDirectory, prune(state)),
    )
    return writes
  }

  /** Read the mounted bundles, each with its per-machine track. */
  const watched = async () => {
    const source = await bundleSource({ env, argv })
    return source.bundles.map((bundle) => ({ ...bundle, track: trackOf(bundle.name) }))
  }

  /** Fold one checked row into the persisted bundle records. */
  const recordRow = (row, batchAt) => {
    state = upsertBundle(state, row.name, {
      dir: row.dir,
      origin: 'linked',
      branch: row.branch ?? null,
      head: row.head ?? null,
      track: trackOf(row.name),
      status: row.status,
      ahead: row.ahead ?? 0,
      behind: row.behind ?? 0,
      theirs: row.theirs ?? [],
      error: row.error ?? null,
      lastCheck: batchAt,
      stale: row.stale === true,
    })
  }

  /** Record a successful move (and a switch's new track) or nothing. */
  const recordMove = (kind, name, result) => {
    if (result === null || typeof result !== 'object' || result.ok !== true) return
    if (result.snapshot) state = appendSnapshot(state, result.snapshot)
    if (result.receipt) state = appendHistory(state, result.receipt)
    if (result.receipt?.kind === 'switch' && typeof result.receipt.track === 'string') {
      state = upsertBundle(state, name, { track: result.receipt.track })
    }
  }

  /**
   * Load the state file and hydrate the cached rows from it. No network.
   *
   * @returns {Promise<object>} the core's snapshot.
   */
  async function load() {
    const loaded = await loadState(stateDirectory)
    state = loaded.state
    if (loaded.error !== null && log?.warn) log.warn(`dsh-plugin-viburnum: ${loaded.error}`)

    rows = Object.entries(state.bundles)
      .filter(([, record]) => record !== null && typeof record === 'object')
      .map(([name, record]) => ({
        name,
        ...record,
        dot: dotFor(record.status),
      }))
      .sort((left, right) => left.name.localeCompare(right.name))

    const times = rows.map((row) => row.lastCheck).filter((value) => typeof value === 'string')
    checkedAt = times.length > 0 ? times.sort().at(-1) : null
    return snapshot()
  }

  /** The cached rows, the aggregate dot and the last check time. */
  function snapshot() {
    return {
      rows: rows.map((row) => ({ ...row })),
      dot: aggregateDot(rows),
      checkedAt,
      config: { ...resolved },
    }
  }

  /**
   * Run one check pass over every mounted bundle (or one of them).
   *
   * @param {{ fetch?: boolean, name?: string | null }} [options] - pass behaviour.
   * @returns {Promise<object>} the snapshot after the pass.
   */
  async function refresh({ fetch: doFetch = true, name = null } = {}) {
    if (refreshing !== null) return refreshing

    refreshing = (async () => {
      const bundles = await watched()
      const targets = name === null ? bundles : bundles.filter((bundle) => bundle.name === name)
      if (name !== null && targets.length === 0) throw coreError('unknown-bundle', `no mounted bundle named "${name}"`)

      const previous = Object.fromEntries(rows.map((row) => [row.name, row]))
      const checked = await checkAll(targets, { doFetch, previous })
      const batchAt = at()

      const merged = new Map(rows.map((row) => [row.name, row]))
      for (const row of checked) {
        merged.set(row.name, row)
        recordRow(row, batchAt)
      }
      rows = [...merged.values()].sort((left, right) => left.name.localeCompare(right.name))
      checkedAt = batchAt
      await commit()
      return snapshot()
    })()

    try {
      return await refreshing
    } finally {
      refreshing = null
    }
  }

  /**
   * Update one bundle, or every mounted bundle when no name is given.
   *
   * @param {string | null} [name] - package name, or null for all.
   * @returns {Promise<object>} the single result or `{ results, ok }`.
   */
  async function update(name = null) {
    const bundles = await watched()
    const targets = name === null ? bundles : bundles.filter((bundle) => bundle.name === name)
    if (name !== null && targets.length === 0) throw coreError('unknown-bundle', `no mounted bundle named "${name}"`)

    const results = []
    for (const bundle of targets) {
      const result = await exclusive(bundle.name, () => updateBundle(bundle))
      recordMove('update', bundle.name, result)
      results.push({ name: bundle.name, ...result })
    }
    await commit()
    await refresh({ fetch: false })
    return name === null ? { results, ok: results.every((result) => result.ok) } : results[0]
  }

  /**
   * Sync one bundle, or every mounted bundle except Viburnum's own row.
   *
   * @param {string | null} [name] - package name, or null for all.
   * @param {{ dryRun?: boolean }} [options] - behaviour.
   * @returns {Promise<object>} the single result, the batch result, or the dry-run plan.
   */
  async function sync(name = null, { dryRun = false } = {}) {
    const bundles = await watched()
    const targets = name === null
      ? bundles.filter((bundle) => bundle.name !== OWN_PACKAGE)
      : bundles.filter((bundle) => bundle.name === name)
    if (name !== null && targets.length === 0) throw coreError('unknown-bundle', `no mounted bundle named "${name}"`)

    if (dryRun) {
      if (name !== null) return syncBundle(targets[0], { dryRun: true })
      return syncAll(targets, { dryRun: true })
    }

    if (name !== null) {
      const result = await exclusive(targets[0].name, () => syncBundle(targets[0]))
      recordMove('sync', targets[0].name, result)
      await commit()
      await refresh({ fetch: false })
      return { name: targets[0].name, ...result }
    }

    const batch = await syncAll(targets)
    for (const result of batch.results) recordMove('sync', result.name, result)
    await commit()
    await refresh({ fetch: false })
    return batch
  }

  /**
   * Switch one bundle to another track.
   *
   * @param {string} name - package name.
   * @param {string} track - branch local or on origin.
   * @returns {Promise<object>} the move result.
   */
  async function switchTo(name, track) {
    const bundles = await watched()
    const bundle = bundles.find((candidate) => candidate.name === name)
    if (bundle === undefined) throw coreError('unknown-bundle', `no mounted bundle named "${name}"`)

    const result = await exclusive(name, () => switchBundle(bundle, track))
    recordMove('switch', name, result)
    await commit()
    await refresh({ fetch: false })
    return { name, ...result }
  }

  /**
   * Restore the latest snapshot recorded for one bundle.
   *
   * @param {string} name - package name.
   * @returns {Promise<object>} the revert result.
   */
  async function revert(name) {
    const bundles = await watched()
    const bundle = bundles.find((candidate) => candidate.name === name)
    if (bundle === undefined) throw coreError('unknown-bundle', `no mounted bundle named "${name}"`)

    const snapshotRecord = [...state.snapshots].reverse().find((entry) => entry.bundle === name) ?? null
    if (snapshotRecord === null) throw coreError('unknown-snapshot', `no snapshot is recorded for "${name}"`)

    const result = await exclusive(name, () => revertBundle(bundle, snapshotRecord))
    if (result.ok) {
      state = appendHistory(state, result.receipt)
      if (snapshotRecord.kind === 'switch' && typeof snapshotRecord.track === 'string') {
        state = upsertBundle(state, name, { track: snapshotRecord.track })
      }
    }
    await commit()
    await refresh({ fetch: false })
    return { name, ...result }
  }

  /**
   * Branches one bundle can switch to.
   *
   * @param {string} name - package name.
   * @returns {Promise<string[]>} branch names.
   */
  async function tracks(name) {
    const bundles = await watched()
    const bundle = bundles.find((candidate) => candidate.name === name)
    if (bundle === undefined) throw coreError('unknown-bundle', `no mounted bundle named "${name}"`)
    return trackChoices(bundle.dir)
  }

  /** Wait for pending state writes and resolve. */
  async function close() {
    await writes
  }

  return {
    config: { ...resolved },
    stateDirectory,
    load,
    snapshot,
    refresh,
    update,
    sync,
    switch: switchTo,
    revert,
    tracks,
    close,
  }
}
