/**
 * The check: read a bundle's git state, classify it, and aggregate the one dot.
 *
 * This module composes the git seam; it never decides a move. `lib/sync.js`
 * owns the update, sync and switch policies.
 *
 * @module viburnum/lib/status
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import {
  counts,
  fetch,
  inspect,
  rebaseInProgress,
  remoteBranches,
  revList,
  verifyRef,
} from './git.js'

/** The status words the page and the CLI print. */
export const STATUS = {
  current: 'current',
  remoteAhead: 'remote-ahead',
  localAhead: 'local-ahead',
  diverged: 'diverged',
  dirty: 'dirty',
  detached: 'detached',
  rebasing: 'rebasing',
  localOnly: 'local-only',
  missing: 'missing',
  unknown: 'unknown',
}

/** At most this many git processes run at once during one check pass. */
export const CHECK_CONCURRENCY = 3

/** Which dot colour a status produces. */
const DOT = {
  [STATUS.current]: 'green',
  [STATUS.remoteAhead]: 'violet',
  [STATUS.dirty]: 'orange',
  [STATUS.localAhead]: 'red',
  [STATUS.diverged]: 'red',
  [STATUS.detached]: 'grey',
  [STATUS.rebasing]: 'grey',
  [STATUS.localOnly]: 'grey',
  [STATUS.missing]: 'grey',
  [STATUS.unknown]: 'grey',
}

/** Precedence of the dot across bundles: higher wins. red > orange > violet > grey > green. */
const DOT_RANK = { grey: 2, violet: 3, orange: 4, red: 5, green: 1 }

/**
 * The dot colour for one status.
 *
 * @param {string} status - one of `STATUS`.
 * @returns {'green' | 'violet' | 'orange' | 'red' | 'grey'} colour name.
 */
export function dotFor(status) {
  return DOT[status] ?? 'grey'
}

/**
 * The aggregated dot across rows: the worst state wins.
 *
 * @param {Array<{ dot?: string }>} rows - checked rows.
 * @returns {'green' | 'violet' | 'orange' | 'red' | 'grey'} colour name.
 */
export function aggregateDot(rows) {
  let worst = 'green'
  for (const row of rows ?? []) {
    const dot = row?.dot ?? 'grey'
    if ((DOT_RANK[dot] ?? 2) > (DOT_RANK[worst] ?? 1)) worst = dot
  }
  return worst
}

/**
 * Classify one inspected checkout.
 *
 * @param {object} input - classification inputs.
 * @param {{ ok: boolean, reason?: string, detached?: boolean }} input.inspection - `inspect` result.
 * @param {boolean} input.rebasing - whether a rebase is in progress.
 * @param {boolean} input.hasOrigin - whether the checkout has an `origin`.
 * @param {{ behind: number, ahead: number }} input.counts - direction counts.
 * @param {boolean} input.dirty - whether the tree has uncommitted changes.
 * @returns {string} one of `STATUS`.
 */
export function classify({ inspection, rebasing, hasOrigin, counts: directions, dirty }) {
  if (!inspection.ok) return inspection.reason === 'missing' ? STATUS.missing : STATUS.unknown
  if (rebasing) return STATUS.rebasing
  if (inspection.detached) return STATUS.detached
  if (dirty) return STATUS.dirty
  if (!hasOrigin) return STATUS.localOnly
  if (directions.behind > 0 && directions.ahead > 0) return STATUS.diverged
  if (directions.ahead > 0) return STATUS.localAhead
  if (directions.behind > 0) return STATUS.remoteAhead
  return STATUS.current
}

/** Icon media types the page can inline. */
const ICON_MIME = {
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
}

/** Largest package icon this page inlines. */
const MAX_ICON_BYTES = 200_000

/**
 * Read the manifest facts a row shows and the compatibility scan needs: the
 * declared version, the `engines.dsh` range and an inlinable package icon.
 *
 * @param {string} dir - checkout directory.
 * @returns {Promise<{ version: string | null, enginesDsh: string | null, icon: string | null }>} manifest facts.
 */
async function installedManifest(dir) {
  let pkg
  try {
    pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'))
  } catch {
    return { version: null, enginesDsh: null, icon: null }
  }

  const version = typeof pkg?.version === 'string' ? pkg.version : null
  const enginesDsh = typeof pkg?.engines?.dsh === 'string' ? pkg.engines.dsh : null

  let icon = null
  const declared = typeof pkg?.icon === 'string' ? pkg.icon.trim() : ''
  if (declared !== '' && !/^(?:[a-z]+:)?\/\//iu.test(declared)) {
    const path = join(dir, declared)
    const ext = declared.slice(declared.lastIndexOf('.')).toLowerCase()
    const mime = ICON_MIME[ext]
    if (mime !== undefined) {
      try {
        const data = await readFile(path)
        if (data.length <= MAX_ICON_BYTES) icon = `data:${mime};base64,${data.toString('base64')}`
      } catch {
        icon = null
      }
    }
  }

  return { version, enginesDsh, icon }
}

/**
 * Check one bundle, fetching first when asked.
 *
 * A failed fetch keeps the previous row and marks it stale, with git's own
 * sentence quoted once; it never throws for an ordinary git failure.
 *
 * @param {{ name: string, dir: string, track?: string | null, previous?: object | null }} bundle - the bundle.
 * @param {{ doFetch?: boolean, timeoutMs?: number, signal?: AbortSignal, gitOptions?: object }} [options] - check behaviour.
 * @returns {Promise<object>} the row.
 */
export async function checkBundle(bundle, { doFetch = true, signal, gitOptions = {} } = {}) {
  const options = { ...gitOptions, signal }
  const inspection = await inspect(bundle.dir, options)

  if (!inspection.ok) {
    const status = inspection.reason === 'missing' ? STATUS.missing : STATUS.unknown
    return {
      name: bundle.name,
      dir: bundle.dir,
      track: bundle.track ?? null,
      status,
      dot: dotFor(status),
      version: null,
      enginesDsh: null,
      icon: null,
      error: inspection.error ?? null,
      stale: false,
      checkedAt: new Date().toISOString(),
    }
  }

  const rebasing = await rebaseInProgress(bundle.dir, options)
  const track = bundle.track ?? (inspection.detached ? null : inspection.branch) ?? 'main'
  const hasOrigin = inspection.remote !== null
  const manifest = await installedManifest(bundle.dir)
  const version = manifest.version

  let stale = false
  let staleError = null
  if (hasOrigin && doFetch) {
    let fetched
    try {
      fetched = await fetch(bundle.dir, options)
    } catch (error) {
      fetched = { code: null, stderr: error.message }
    }
    if (fetched.code !== 0) {
      const previous = bundle.previous
      if (previous !== undefined && previous !== null) {
        return {
          ...previous,
          stale: true,
          staleError: (fetched.stderr ?? '').trim() || 'fetch failed',
          checkedAt: new Date().toISOString(),
        }
      }
      stale = true
      staleError = (fetched.stderr ?? '').trim() || 'fetch failed'
    }
  }

  const upstream = hasOrigin ? `origin/${track}` : null
  let directions = { behind: 0, ahead: 0 }
  let theirs = []
  let yours = []
  let error = staleError

  if (upstream !== null) {
    const ref = await verifyRef(bundle.dir, upstream, options)
    if (ref === null) {
      const status = STATUS.unknown
      return {
        name: bundle.name,
        dir: bundle.dir,
        track,
        status,
        dot: dotFor(status),
        version,
        enginesDsh: manifest.enginesDsh,
        icon: manifest.icon,
        branch: inspection.branch,
        head: inspection.head,
        error: `no such branch: ${upstream}`,
        stale,
        checkedAt: new Date().toISOString(),
      }
    }

    try {
      directions = await counts(bundle.dir, upstream, options)
      theirs = await revList(bundle.dir, `HEAD..${upstream}`, { limit: 20, ...options })
      yours = await revList(bundle.dir, `${upstream}..HEAD`, { limit: 20, ...options })
    } catch (error_) {
      directions = { behind: 0, ahead: 0 }
      error = error_.message
    }
  }

  const status = classify({
    inspection,
    rebasing,
    hasOrigin,
    counts: directions,
    dirty: inspection.dirty,
  })

  return {
    name: bundle.name,
    dir: bundle.dir,
    track,
    status,
    dot: dotFor(status),
    version,
    enginesDsh: manifest.enginesDsh,
    icon: manifest.icon,
    branch: inspection.branch,
    head: inspection.head,
    remote: inspection.remote,
    dirty: inspection.dirty,
    dirtyCount: inspection.dirtyCount,
    detached: inspection.detached,
    behind: directions.behind,
    ahead: directions.ahead,
    theirs,
    yours,
    error,
    stale,
    checkedAt: new Date().toISOString(),
  }
}

/**
 * Check every bundle in a bounded parallel pass.
 *
 * @param {Array<{ name: string, dir: string, track?: string | null }>} bundles - bundles to check.
 * @param {{ doFetch?: boolean, previous?: Record<string, object>, concurrency?: number, gitOptions?: object, signal?: AbortSignal }} [options] - check behaviour.
 * @returns {Promise<Array<object>>} rows in bundle order.
 */
export async function checkAll(bundles, {
  doFetch = true,
  previous = {},
  concurrency = CHECK_CONCURRENCY,
  gitOptions = {},
  signal,
} = {}) {
  const rows = new Array(bundles.length)
  let next = 0

  const worker = async () => {
    for (;;) {
      const index = next
      next += 1
      if (index >= bundles.length) return
      const bundle = bundles[index]
      try {
        rows[index] = await checkBundle(
          { ...bundle, previous: previous[bundle.name] ?? null },
          { doFetch, gitOptions, signal },
        )
      } catch (error) {
        rows[index] = {
          name: bundle.name,
          dir: bundle.dir,
          track: bundle.track ?? null,
          status: STATUS.unknown,
          dot: dotFor(STATUS.unknown),
          error: error.message,
          stale: false,
          checkedAt: new Date().toISOString(),
        }
      }
    }
  }

  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, bundles.length)) }, () => worker())
  await Promise.all(workers)
  return rows
}

/**
 * Remote branch names a bundle can be switched to, without the symbolic HEAD.
 *
 * @param {string} dir - checkout directory.
 * @param {{ timeoutMs?: number, signal?: AbortSignal }} [options] - git options.
 * @returns {Promise<string[]>} branch names such as `main`, `dev`.
 */
export async function trackChoices(dir, options) {
  const remotes = await remoteBranches(dir, options)
  return remotes.map((ref) => ref.replace(/^origin\//u, ''))
}
