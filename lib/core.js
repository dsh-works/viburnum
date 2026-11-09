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

import { access, mkdir, readFile } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'

import { resolveConfig } from './config.js'
import { CATALOG_TTL_MS } from './catalog.js'
import { dshHome } from './profile.js'
import {
  counts,
  diffNames,
  inspect,
  localBranches,
  remoteBranches,
  showFile,
  verifyRef,
} from './git.js'
import { dotFor, aggregateDot, checkAll, trackChoices } from './status.js'
import {
  appendHistory,
  appendSnapshot,
  appendTimeline,
  defaultState,
  loadState,
  prune,
  saveState,
  stateDir,
  upsertBundle,
} from './state.js'
import { revertBundle, syncAll, syncBundle, switchBundle, updateBundle } from './sync.js'
import { runningDshVersion, satisfiesRange } from './version-check.js'
import { buildChangelog, reloadClass, reloadLabel, suggestNextVersion } from './version.js'

/** The package name of viburnum itself; `Sync all` skips its own row (D12). */
export const OWN_PACKAGE = 'dsh-plugin-viburnum'

/** One typed failure for callers that want a code, not a parsed message. */
export function coreError(code, message) {
  const error = new Error(message)
  error.name = 'viburnumError'
  error.code = code
  return error
}

/** The files a bundle detail can hand to the desktop. */
const OPEN_TARGETS = {
  folder: null,
  readme: 'README.md',
  changelog: 'CHANGELOG.md',
}

/** The files a bundle detail can show inline. */
const DOCUMENT_TARGETS = {
  readme: 'README.md',
  changelog: 'CHANGELOG.md',
}

/** Cap for one document handed to the page. */
export const MAX_DOCUMENT_BYTES = 48 * 1024

/** A GitHub `owner/repo` shorthand or one path-shaped repository name. */
const REPOSITORY_NAME = /^[A-Za-z0-9._-]+$/u

/** Normalize a repository door input into a clone URL and a shelf name. */
function repositoryOf(input) {
  const text = typeof input === 'string' ? input.trim() : ''
  if (text === '') return null

  if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(text)) {
    const name = text.split('/')[1].replace(/\.git$/u, '')
    return REPOSITORY_NAME.test(name) ? { url: `https://github.com/${text.replace(/\.git$/u, '')}.git`, name } : null
  }

  let parsed = null
  try {
    parsed = new URL(text)
  } catch {
    const scp = /^git@([^:]+):(.+)$/u.exec(text)
    if (scp === null) return null
    const tail = scp[2].replace(/\/+$/u, '').replace(/\.git$/u, '')
    const name = tail.split('/').pop()
    return name && REPOSITORY_NAME.test(name) ? { url: text, name } : null
  }

  if (!['https:', 'ssh:', 'git:'].includes(parsed.protocol)) return null
  if (parsed.username !== '' || parsed.password !== '') return null
  if (parsed.search !== '' || parsed.hash !== '') return null
  const tail = parsed.pathname.replace(/\/+$/u, '').replace(/\.git$/u, '')
  const name = tail.split('/').pop()
  return name && REPOSITORY_NAME.test(name) ? { url: text, name } : null
}

/** Read what the directory door needs from a checkout's manifest. */
async function readPluginManifest(dir) {
  let pkg
  try {
    pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'))
  } catch (error) {
    return { ok: false, code: 'not-a-package', message: `cannot read ${join(dir, 'package.json')}: ${error.message}` }
  }
  if (pkg === null || typeof pkg !== 'object' || typeof pkg.name !== 'string' || pkg.name.trim() === '') {
    return { ok: false, code: 'not-a-package', message: `${dir} has no package name` }
  }
  const bundle = pkg.dsh?.bundle
  if (bundle === null || typeof bundle !== 'object' || typeof bundle.patch !== 'string' || bundle.patch.trim() === '') {
    return { ok: false, code: 'not-a-bundle', message: `${pkg.name} does not declare dsh.bundle.patch` }
  }
  return {
    ok: true,
    name: pkg.name.trim(),
    version: typeof pkg.version === 'string' ? pkg.version : null,
  }
}

/**
 * Convert one plugin-manager install outcome into the page's receipt.
 *
 * @param {object} outcome - a `ChangeResult` from `pluginManager.installBundle`.
 * @param {string} door - `directory` or `repository`.
 * @param {object} manifest - the local manifest read before installing.
 * @returns {object} an installed receipt or a readable refusal.
 */
function installReceipt(outcome, door, manifest, extra) {
  if (outcome === null || typeof outcome !== 'object') {
    return { ok: false, code: 'install-failed', message: 'the plugin manager returned no result' }
  }
  if (outcome.application === 'failed') {
    return {
      ok: false,
      code: 'install-failed',
      message: outcome.error?.diagnostic ?? outcome.error?.code ?? 'the plugin manager reported a failure',
    }
  }
  if (outcome.application === 'cancelled') {
    return { ok: false, code: 'cancelled', message: 'the installation was cancelled' }
  }
  return {
    ok: true,
    installed: true,
    door,
    name: outcome.bundle ?? manifest.name,
    version: outcome.version ?? manifest.version,
    application: outcome.application,
    path: extra?.path ?? null,
    cloned: extra?.cloned === true,
    repository: extra?.repository ?? null,
  }
}

/** Read a package version out of a package.json body. */
function versionOf(text) {
  try {
    const pkg = JSON.parse(text)
    return typeof pkg.version === 'string' ? pkg.version : null
  } catch {
    return null
  }
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
  installer = null,
  inspector = null,
  cloner = null,
  catalogFetcher = null,
  hygieneScanner = null,
  dshVersion = null,
} = {}) {
  if (typeof bundleSource !== 'function') throw new Error('dsh-plugin-viburnum: createCore needs a bundleSource')
  if (typeof config === 'function') throw new Error('dsh-plugin-viburnum: pass configuration values, not a factory')

  const resolved = resolveConfig(config)
  const stateDirectory = stateDir({ env })
  const shelfDirectory = resolved.pluginsDir === ''
    ? join(dshHome(env), 'viburnum', 'plugins')
    : resolve(resolved.pluginsDir)
  const queues = new Map()
  const catalogCache = new Map()

  let state = defaultState()
  let rows = []
  let checkedAt = null
  let ownVersion = null
  let refreshing = null
  let writes = Promise.resolve()
  let hygieneCache = null
  let runningDsh = null
  let previousDsh = null

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
      version: row.version ?? null,
      enginesDsh: row.enginesDsh ?? null,
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
    let text = kind
    if (result.receipt?.kind === 'switch') text = `on ${result.receipt.track}`
    else if (result.receipt) text = `pushed ${result.receipt.pushed}, pulled ${result.receipt.pulled}, rebased ${result.receipt.rebased}`
    state = appendTimeline(state, { at: at(), kind, bundle: name, text, seen: false })
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
    try {
      ownVersion = versionOf(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
    } catch {
      ownVersion = null
    }

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

    runningDsh = dshVersion ?? await runningDshVersion()
    if (typeof state.dshVersion === 'string' && runningDsh !== null && state.dshVersion !== runningDsh) {
      previousDsh = state.dshVersion
    }
    if (runningDsh !== null && state.dshVersion !== runningDsh) {
      state = { ...state, dshVersion: runningDsh }
      await commit()
    }
    return snapshot()
  }

  /** The user's saved settings over the row configuration's defaults. */
  function settingsOf() {
    const stored = state.settings ?? {}
    return {
      checkIntervalMinutes: Number.isInteger(stored.checkIntervalMinutes)
        ? stored.checkIntervalMinutes
        : resolved.checkIntervalMinutes,
      refreshOnStartup: typeof stored.refreshOnStartup === 'boolean' ? stored.refreshOnStartup : true,
      versionWarnings: typeof stored.versionWarnings === 'boolean' ? stored.versionWarnings : true,
    }
  }

  /** Save a settings patch (interval, startup refresh, version warnings). */
  async function setSettings(patch) {
    if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
      throw coreError('invalid-settings', 'settings need an object')
    }
    const next = { ...(state.settings ?? {}) }
    if (patch.checkIntervalMinutes !== undefined) {
      if (!Number.isInteger(patch.checkIntervalMinutes)
        || patch.checkIntervalMinutes < 0
        || patch.checkIntervalMinutes > 1440) {
        throw coreError('invalid-settings', 'checkIntervalMinutes must be an integer between 0 and 1440')
      }
      next.checkIntervalMinutes = patch.checkIntervalMinutes
    }
    for (const key of ['refreshOnStartup', 'versionWarnings']) {
      if (patch[key] === undefined) continue
      if (typeof patch[key] !== 'boolean') throw coreError('invalid-settings', `${key} must be a boolean`)
      next[key] = patch[key]
    }
    state = { ...state, settings: next }
    await commit()
    return { ...snapshot(), saved: true }
  }

  /** Harness drift and engines.dsh mismatches, as warnings the page can show. */
  function compatibility() {
    const warnings = []
    if (previousDsh !== null && runningDsh !== null) {
      warnings.push({
        kind: 'harness-update',
        from: previousDsh,
        to: runningDsh,
        message: `Harness changed from ${previousDsh} to ${runningDsh}; recheck every plugin's engines.dsh and peer ranges.`,
      })
    }
    if (settingsOf().versionWarnings) {
      for (const row of rows) {
        if (typeof row.enginesDsh !== 'string' || row.enginesDsh === '' || runningDsh === null) continue
        if (satisfiesRange(runningDsh, row.enginesDsh)) continue
        warnings.push({
          kind: 'engine-mismatch',
          bundle: row.name,
          version: row.version ?? null,
          requires: row.enginesDsh,
          running: runningDsh,
          message: `${row.name} declares engines.dsh ${row.enginesDsh}; the running harness is ${runningDsh}.`,
        })
      }
    }
    return { runningDsh, previousDsh, warnings }
  }

  /** The cached rows, the aggregate dot and the last check time. */
  function snapshot() {
    return {
      rows: rows.map((row) => ({ ...row })),
      dot: aggregateDot(rows),
      checkedAt,
      version: ownVersion,
      settings: settingsOf(),
      compat: compatibility(),
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
        const seen = state.seen[row.name]
        if (seen !== undefined && (row.behind ?? 0) > 0
          && ((row.behind ?? 0) !== seen.behind || (row.head ?? null) !== (seen.head ?? null))) {
          const subjects = (row.theirs ?? [])
            .slice(0, 3)
            .map((entry) => entry.subject)
            .filter((subject) => typeof subject === 'string')
          state = appendTimeline(state, {
            at: batchAt,
            kind: 'incoming',
            bundle: row.name,
            count: row.behind,
            subjects,
            seen: false,
          })
        }
        state = { ...state, seen: { ...state.seen, [row.name]: { head: row.head ?? null, behind: row.behind ?? 0 } } }
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
   * Sync one bundle, or every mounted bundle except viburnum's own row.
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
   * Read one bundle's working page: branches, the incoming side of its track,
   * the changelog, the version drift and the reload class.
   *
   * This is a local read: it never fetches and never moves anything.
   *
   * @param {string} name - package name.
   * @returns {Promise<object>} the detail, or a readable failure when the checkout is unreadable.
   */
  async function detail(name) {
    const bundles = await watched()
    const bundle = bundles.find((candidate) => candidate.name === name)
    if (bundle === undefined) throw coreError('unknown-bundle', `no mounted bundle named "${name}"`)

    const row = rows.find((entry) => entry.name === name) ?? null
    const inspection = await inspect(bundle.dir)
    if (!inspection.ok) {
      return {
        ok: false,
        code: inspection.reason === 'missing' ? 'missing' : 'unknown',
        message: inspection.error,
        bundle: { name, dir: bundle.dir },
      }
    }

    let currentVersion = null
    try {
      currentVersion = versionOf(await readFile(join(bundle.dir, 'package.json'), 'utf8'))
    } catch {
      // A checkout without a readable package.json still has git state to show.
    }

    const track = bundle.track ?? (inspection.detached ? null : inspection.branch) ?? 'main'
    const locals = await localBranches(bundle.dir)
    const remotes = (await remoteBranches(bundle.dir)).map((ref) => ref.replace(/^origin\//u, ''))
    const branches = [...new Set(
      [track, 'main', 'dev', ...locals, ...remotes].filter((entry) => typeof entry === 'string' && entry !== ''),
    )]

    let incoming = null
    if (inspection.remote !== null && !inspection.detached) {
      const upstream = `origin/${track}`
      if ((await verifyRef(bundle.dir, upstream)) !== null) {
        const directions = await counts(bundle.dir, upstream)
        const targetFile = await showFile(bundle.dir, upstream, 'package.json')
        const targetVersion = targetFile.ok ? versionOf(targetFile.text) : null
        let changelog = null
        try {
          changelog = await buildChangelog(bundle.dir, { from: inspection.head, to: upstream, version: targetVersion })
        } catch {
          // The changelog is an extra; its failure must not hide the direction.
        }
        let changed = []
        try {
          changed = await diffNames(bundle.dir, inspection.head, upstream)
        } catch {
          // Same for the changed-path list.
        }
        const reload = reloadClass(changed)
        incoming = {
          behind: directions.behind,
          ahead: directions.ahead,
          targetVersion,
          currentVersion,
          nextVersion: changelog !== null && currentVersion !== null
            ? suggestNextVersion(changelog, currentVersion)
            : null,
          changelog,
          changed,
          reload,
          reloadLabel: reloadLabel(reload),
        }
      }
    }

    return {
      ok: true,
      bundle: {
        name,
        dir: bundle.dir,
        version: currentVersion,
        track,
        branch: inspection.branch,
        head: inspection.head,
        dirty: inspection.dirty,
        dirtyCount: inspection.dirtyCount,
        detached: inspection.detached,
        status: row?.status ?? null,
        dot: row?.dot ?? 'grey',
      },
      branches,
      incoming,
    }
  }

  /**
   * Resolve one place a bundle detail can hand to the desktop: the checkout
   * folder, its README or its CHANGELOG. The path is always inside the bundle.
   *
   * @param {string} name - package name.
   * @param {string} target - `folder`, `readme` or `changelog`.
   * @returns {Promise<object>} `{ ok: true, path, target }` or a refusal.
   */
  async function openTarget(name, target) {
    const bundles = await watched()
    const bundle = bundles.find((candidate) => candidate.name === name)
    if (bundle === undefined) throw coreError('unknown-bundle', `no mounted bundle named "${name}"`)
    if (typeof target !== 'string' || !Object.hasOwn(OPEN_TARGETS, target)) {
      return { ok: false, code: 'unknown-target', message: `unknown open target: ${String(target)}` }
    }

    const path = OPEN_TARGETS[target] === null ? bundle.dir : join(bundle.dir, OPEN_TARGETS[target])
    try {
      await access(path)
    } catch {
      return { ok: false, code: 'missing-file', message: `no ${target} in ${bundle.dir}`, path }
    }
    return { ok: true, name, target, path }
  }

  /**
   * Read one document from a bundle for inline display: its README or
   * CHANGELOG, capped so a huge file cannot bloat the page payload.
   *
   * @param {string} name - package name.
   * @param {string} target - `readme` or `changelog`.
   * @returns {Promise<object>} `{ ok: true, text, truncated }` or a refusal.
   */
  async function readDocument(name, target) {
    if (typeof target !== 'string' || !Object.hasOwn(DOCUMENT_TARGETS, target)) {
      return { ok: false, code: 'unknown-target', message: `unknown document: ${String(target)}` }
    }
    const resolved = await openTarget(name, target)
    if (!resolved.ok) return resolved

    let text
    try {
      text = await readFile(resolved.path, 'utf8')
    } catch (error) {
      return { ok: false, code: 'unreadable-document', message: `cannot read ${resolved.path}: ${error.message}` }
    }
    const truncated = text.length > MAX_DOCUMENT_BYTES
    return {
      ok: true,
      name: resolved.name,
      target,
      path: resolved.path,
      text: truncated ? text.slice(0, MAX_DOCUMENT_BYTES) : text,
      truncated,
    }
  }

  /**
   * Adopt an existing checkout through the directory door: validate its
   * manifest, then hand it to the plugin manager's install operation.
   *
   * @param {string} input - absolute path to the checkout.
   * @param {{ source?: string }} [options] - `directory` or `repository`.
   * @returns {Promise<object>} an installed receipt or a readable refusal.
   */
  async function installDirectory(input, { source = 'directory' } = {}) {
    if (typeof installer !== 'function' || typeof inspector !== 'function') {
      return { ok: false, code: 'install-unavailable', message: 'this Host does not expose the plugin manager install operation' }
    }
    const text = typeof input === 'string' ? input.trim() : ''
    if (text === '' || !isAbsolute(text)) {
      return { ok: false, code: 'invalid-directory', message: 'enter an absolute directory path' }
    }
    const dir = resolve(text)
    try {
      await access(join(dir, 'package.json'))
    } catch {
      return { ok: false, code: 'missing-directory', message: `no package.json in ${dir}` }
    }

    const manifest = await readPluginManifest(dir)
    if (!manifest.ok) return manifest

    const already = (await watched()).find((bundle) => bundle.name === manifest.name)
    if (already !== undefined) {
      return { ok: false, code: 'already-installed', message: `${manifest.name} is already linked from ${already.dir}` }
    }

    let inspection
    try {
      inspection = await inspector(dir)
    } catch (error) {
      return { ok: false, code: 'inspect-failed', message: error.message }
    }
    if (inspection?.status === 'refused') {
      return { ok: false, code: inspection.problem, message: inspection.reason }
    }

    let outcome
    try {
      outcome = await installer(dir)
    } catch (error) {
      return { ok: false, code: 'install-failed', message: error.message }
    }
    const receipt = installReceipt(outcome, source, manifest, { path: dir })
    if (receipt.ok) {
      state = appendTimeline(state, {
        at: at(),
        kind: 'install',
        bundle: receipt.name,
        text: 'linked from its directory',
        seen: false,
      })
      await commit()
      await refresh({ fetch: false }).catch(() => {})
    }
    return receipt
  }

  /**
   * Adopt a repository URL through the shelf: clone it into `pluginsDir`, then
   * link the fresh checkout. An existing shelf directory is never overwritten.
   *
   * @param {string} input - GitHub URL, `owner/repo`, or an https/ssh git URL.
   * @returns {Promise<object>} an installed receipt or a readable refusal.
   */
  async function installRepository(input) {
    if (typeof cloner !== 'function') {
      return { ok: false, code: 'install-unavailable', message: 'this Host cannot clone repositories' }
    }
    const repository = repositoryOf(input)
    if (repository === null) {
      return {
        ok: false,
        code: 'invalid-repository',
        message: 'enter owner/repo, a GitHub URL, or an https/ssh git URL without credentials',
      }
    }

    const target = join(shelfDirectory, repository.name)
    try {
      await mkdir(shelfDirectory, { recursive: true })
    } catch (error) {
      return { ok: false, code: 'shelf-unavailable', message: `cannot create ${shelfDirectory}: ${error.message}` }
    }

    try {
      await access(target)
      const already = (await watched()).find((bundle) => resolve(bundle.dir) === target)
      if (already !== undefined) {
        return { ok: false, code: 'already-installed', message: `${already.name} is already linked from ${target}` }
      }
      return {
        ok: false,
        code: 'shelf-collision',
        message: `${target} already exists; move it or link it through the directory door`,
        path: target,
      }
    } catch {
      // The shelf slot is free.
    }

    try {
      await cloner(repository.url, target)
    } catch (error) {
      return { ok: false, code: 'clone-failed', message: error.message, repository: repository.url, path: target }
    }

    const receipt = await installDirectory(target, { source: 'repository' })
    return receipt.ok
      ? { ...receipt, cloned: true, repository: repository.url }
      : { ...receipt, cloned: true, repository: repository.url, path: target }
  }

  /**
   * List the configured owners' repositories for the organisation door.
   * Successful answers stay cached for ten minutes; a failure is retried after
   * one minute and never fails the other owners.
   *
   * @param {{ refresh?: boolean, owners?: string[] }} [options] - cache override and owner subset.
   * @returns {Promise<object>} `{ ok: true, owners: [...] }` or a refusal when no catalog exists.
   */
  async function catalog({ refresh = false, owners = resolved.catalogOwners } = {}) {
    if (typeof catalogFetcher !== 'function') {
      return { ok: false, code: 'catalog-unavailable', message: 'this Host cannot read the GitHub catalog' }
    }
    const at = Date.now()
    const results = []
    for (const owner of owners) {
      const entry = catalogCache.get(owner)
      const ttl = entry?.error ? 60_000 : CATALOG_TTL_MS
      if (!refresh && entry !== undefined && at - entry.at < ttl) {
        results.push({
          owner,
          repos: entry.repos,
          fetchedAt: new Date(entry.at).toISOString(),
          cached: true,
          error: entry.error,
        })
        continue
      }
      try {
        const repos = await catalogFetcher(owner)
        catalogCache.set(owner, { repos, at, error: null })
        results.push({ owner, repos, fetchedAt: new Date(at).toISOString(), cached: false, error: null })
      } catch (error) {
        const repos = entry?.repos ?? []
        catalogCache.set(owner, { repos, at, error: error.message })
        results.push({ owner, repos, fetchedAt: new Date(at).toISOString(), cached: false, error: error.message })
      }
    }
    return { ok: true, owners: results }
  }

  /**
   * The unread timeline feed: actions and incoming commits since the last look.
   * Reading it marks those events seen (the design's "cleared by looking").
   *
   * @param {{ markSeen?: boolean, limit?: number }} [options] - behaviour.
   * @returns {Promise<{ ok: true, events: object[] }>} newest first.
   */
  async function timeline({ markSeen = true, limit = 20 } = {}) {
    const pending = (state.timeline ?? []).filter((event) => event?.seen !== true)
    const events = pending.slice(-limit).reverse()
    if (markSeen && events.length > 0) {
      const marked = new Set(events)
      state = {
        ...state,
        timeline: state.timeline.map((event) => (marked.has(event) ? { ...event, seen: true } : event)),
      }
      await commit()
    }
    return { ok: true, events }
  }

  /**
   * Scan the workspace and the shelf for what the profile cannot see.
   * The scanner never deletes or moves anything.
   *
   * @param {{ refresh?: boolean }} [options] - cache override.
   * @returns {Promise<object>} findings, the scanned checkouts and the roots.
   */
  async function hygiene({ refresh = false } = {}) {
    if (typeof hygieneScanner !== 'function') {
      return { ok: false, code: 'hygiene-unavailable', message: 'this Host cannot scan the workspace' }
    }
    if (!refresh && hygieneCache !== null) {
      const at = Date.parse(hygieneCache.scannedAt)
      if (Number.isFinite(at) && Date.now() - at < 5 * 60 * 1000) return { ...hygieneCache, cached: true }
    }
    try {
      const result = await hygieneScanner()
      hygieneCache = { ...result, cached: false }
      return hygieneCache
    } catch (error) {
      return { ok: false, code: 'hygiene-failed', message: error.message }
    }
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
    detail,
    openTarget,
    readDocument,
    installDirectory,
    installRepository,
    catalog,
    timeline,
    hygiene,
    setSettings,
    shelfDirectory,
    close,
  }
}
