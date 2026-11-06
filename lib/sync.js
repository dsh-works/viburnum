/**
 * The move policies: update (fast-forward only), sync, switch and revert.
 *
 * The rules are the design's: never commit, never force-push, rebase only
 * unpublished local commits, abort a conflicting rebase before reporting it,
 * and leave a clean, explainable tree behind every outcome.
 *
 * Every function returns a plain result object: `{ ok: true, receipt, ... }` or
 * `{ ok: false, code, message, ... }`. Nothing here writes state; the caller
 * records receipts and snapshots.
 *
 * @module viburnum/lib/sync
 */

import {
  abortRebase,
  counts,
  createTrackingBranch,
  diffNames,
  fastForward,
  fetch,
  headSha,
  inspect,
  localBranches,
  push,
  rebaseInProgress,
  rebaseOnto,
  remoteBranches,
  remoteRefsContaining,
  resetHard,
  revList,
  switchBranch,
  validBranchName,
  verifyRef,
} from './git.js'
import { reloadClass } from './version.js'

/** Failure codes a caller can branch on without parsing a message. */
export const FAILURE = {
  missing: 'missing',
  unknown: 'unknown',
  rebasing: 'rebasing',
  detached: 'detached',
  dirty: 'dirty',
  localOnly: 'local-only',
  notOnTrack: 'not-on-track',
  invalidTrack: 'invalid-track',
  unknownTrack: 'unknown-track',
  fetchFailed: 'fetch-failed',
  notFastForward: 'not-fast-forwardable',
  published: 'published',
  conflict: 'conflict',
  pushRejected: 'push-rejected',
  unknownSnapshot: 'unknown-snapshot',
}

/** Build one failure result. */
function failure(code, message, extra = {}) {
  return { ok: false, code, message, ...extra }
}

/** Build one receipt. */
function receipt(kind, name, from, to, { pushed = 0, pulled = 0, rebased = 0, result = 'applied', ...extra } = {}) {
  return { bundle: name, at: new Date().toISOString(), kind, from, to, pushed, pulled, rebased, result, ...extra }
}

/** One failure for an unreadable checkout. */
function unreadable(bundle, inspection) {
  return failure(
    inspection.reason === 'missing' ? FAILURE.missing : FAILURE.unknown,
    `cannot read ${bundle.dir}: ${inspection.error}`,
    { dir: bundle.dir },
  )
}

/**
 * The gates every move shares: readable tree, no rebase in flight, no dirty
 * tree. `detached` is a gate for update and sync but not for switch.
 *
 * @param {{ name: string, dir: string }} bundle - the bundle.
 * @param {{ allowDetached?: boolean, gitOptions?: object, signal?: AbortSignal }} [options] - gate behaviour.
 * @returns {Promise<{ failure: object } | { inspection: object }>} the gate outcome.
 */
async function gate(bundle, { allowDetached = false, gitOptions = {}, signal } = {}) {
  const options = { ...gitOptions, signal }
  const inspection = await inspect(bundle.dir, options)
  if (!inspection.ok) return { failure: unreadable(bundle, inspection) }

  if (await rebaseInProgress(bundle.dir, options)) {
    return {
      failure: failure(
        FAILURE.rebasing,
        `a rebase is already in progress in ${bundle.dir} — finish it or run \`git rebase --abort\``,
        { dir: bundle.dir },
      ),
    }
  }
  if (!allowDetached && inspection.detached) {
    return { failure: failure(FAILURE.detached, 'HEAD is detached — switch to a branch first', { dir: bundle.dir }) }
  }
  if (inspection.dirty) {
    return {
      failure: failure(
        FAILURE.dirty,
        `${inspection.dirtyCount} uncommitted ${inspection.dirtyCount === 1 ? 'file' : 'files'} — commit or stash first`,
        { dirtyCount: inspection.dirtyCount, hint: 'git stash' },
      ),
    }
  }
  return { inspection }
}

/**
 * The track a move should use, and why it may not be usable.
 *
 * @param {{ name: string, dir: string, track?: string | null }} bundle - the bundle.
 * @param {{ branch: string, detached: boolean }} inspection - inspected checkout.
 * @param {{ gitOptions?: object, signal?: AbortSignal }} [options] - git options.
 * @returns {Promise<{ failure: object } | { track: string }>} the resolved track.
 */
async function resolveTrack(bundle, inspection, { gitOptions = {}, signal } = {}) {
  const track = bundle.track ?? (inspection.detached ? null : inspection.branch) ?? 'main'
  const options = { ...gitOptions, signal }

  if (!(await validBranchName(bundle.dir, track, options))) {
    return { failure: failure(FAILURE.invalidTrack, `"${track}" is not a valid branch name`) }
  }
  if (inspection.branch !== track) {
    return {
      failure: failure(
        FAILURE.notOnTrack,
        `the checkout is on "${inspection.branch}", not on its track "${track}" — switch to the track first`,
        { branch: inspection.branch, track },
      ),
    }
  }
  return { track }
}

/**
 * Whether any local-ahead commit is already contained in a remote branch.
 *
 * @param {string} dir - checkout directory.
 * @param {string[]} commits - local-ahead commit ids.
 * @param {object} options - git options.
 * @returns {Promise<Array<{ sha: string, refs: string[] }>>} published commits with the refs that hold them.
 */
export async function publishedCommits(dir, commits, options = {}) {
  const published = []
  for (const sha of commits) {
    const refs = await remoteRefsContaining(dir, sha, options)
    if (refs.length > 0) published.push({ sha, refs })
  }
  return published
}

/**
 * Update one bundle: fetch, then fast-forward only.
 *
 * @param {{ name: string, dir: string, track?: string | null }} bundle - the bundle.
 * @param {{ gitOptions?: object, signal?: AbortSignal }} [options] - git options.
 * @returns {Promise<object>} `{ ok: true, receipt, snapshot }` or a failure.
 */
export async function updateBundle(bundle, { gitOptions = {}, signal } = {}) {
  const options = { ...gitOptions, signal }
  const gated = await gate(bundle, { gitOptions, signal })
  if (gated.failure) return gated.failure

  const inspection = gated.inspection
  if (inspection.remote === null) {
    return failure(FAILURE.localOnly, 'no origin remote — this checkout cannot be updated')
  }
  const resolved = await resolveTrack(bundle, inspection, { gitOptions, signal })
  if (resolved.failure) return resolved.failure
  const { track } = resolved

  const fetched = await fetch(bundle.dir, options)
  if (fetched.code !== 0) {
    return failure(FAILURE.fetchFailed, (fetched.stderr || '').trim() || 'fetch failed', { track })
  }

  const upstream = `origin/${track}`
  if ((await verifyRef(bundle.dir, upstream, options)) === null) {
    return failure(FAILURE.unknownTrack, `origin has no branch "${track}"`, { track })
  }

  const directions = await counts(bundle.dir, upstream, options)
  const from = inspection.head
  const moved = await fastForward(bundle.dir, upstream, options)
  if (!moved.ok) {
    return failure(
      FAILURE.notFastForward,
      `cannot fast-forward "${track}" onto ${upstream} — the histories diverged`,
      { result: moved.result },
    )
  }

  const to = await headSha(bundle.dir, options)
  return {
    ok: true,
    receipt: receipt('update', bundle.name, from, to, { pulled: directions.behind }),
    snapshot: {
      bundle: bundle.name,
      at: new Date().toISOString(),
      kind: 'update',
      dir: bundle.dir,
      branch: inspection.branch,
      track,
      head: from,
      to,
    },
  }
}

/**
 * Sync one bundle: fetch, push, fast-forward, or rebase unpublished commits.
 *
 * @param {{ name: string, dir: string, track?: string | null }} bundle - the bundle.
 * @param {{ dryRun?: boolean, gitOptions?: object, signal?: AbortSignal }} [options] - behaviour.
 * @returns {Promise<object>} `{ ok: true, receipt }`, a dry-run plan, or a failure.
 */
export async function syncBundle(bundle, { dryRun = false, gitOptions = {}, signal } = {}) {
  const options = { ...gitOptions, signal }
  const gated = await gate(bundle, { gitOptions, signal })
  if (gated.failure) return gated.failure

  const inspection = gated.inspection
  if (inspection.remote === null) {
    return failure(FAILURE.localOnly, 'no origin remote — this checkout cannot be synced')
  }
  const resolved = await resolveTrack(bundle, inspection, { gitOptions, signal })
  if (resolved.failure) return resolved.failure
  const { track } = resolved

  if (dryRun) {
    return planSync(bundle, inspection, track, options)
  }

  const fetched = await fetch(bundle.dir, options)
  if (fetched.code !== 0) {
    return failure(FAILURE.fetchFailed, (fetched.stderr || '').trim() || 'fetch failed', { track })
  }

  const upstream = `origin/${track}`
  if ((await verifyRef(bundle.dir, upstream, options)) === null) {
    return failure(FAILURE.unknownTrack, `origin has no branch "${track}"`, { track })
  }

  const directions = await counts(bundle.dir, upstream, options)
  const from = inspection.head

  if (directions.ahead === 0 && directions.behind === 0) {
    return {
      ok: true,
      nothing: true,
      receipt: receipt('sync', bundle.name, from, from, { result: 'nothing', track }),
    }
  }

  if (directions.behind === 0) {
    const pushed = await push(bundle.dir, track, options)
    if (!pushed.ok) {
      return failure(FAILURE.pushRejected, (pushed.result.stderr || '').trim() || 'push was rejected', { track })
    }
    return {
      ok: true,
      receipt: receipt('sync', bundle.name, from, await headSha(bundle.dir, options), {
        pushed: directions.ahead,
        track,
      }),
    }
  }

  if (directions.ahead === 0) {
    const moved = await fastForward(bundle.dir, upstream, options)
    if (!moved.ok) {
      return failure(
        FAILURE.notFastForward,
        `cannot fast-forward "${track}" onto ${upstream} — the histories diverged`,
        { result: moved.result, track },
      )
    }
    return {
      ok: true,
      receipt: receipt('sync', bundle.name, from, await headSha(bundle.dir, options), {
        pulled: directions.behind,
        track,
      }),
    }
  }

  const yours = await revList(bundle.dir, `${upstream}..HEAD`, { limit: 50, ...options })
  const theirs = await revList(bundle.dir, `HEAD..${upstream}`, { limit: 50, ...options })
  const published = await publishedCommits(bundle.dir, yours, options)
  if (published.length > 0) {
    return failure(
      FAILURE.published,
      `${published.length} ${published.length === 1 ? 'commit is' : 'commits are'} already on a remote branch — merge instead of rebase`,
      { published, yours, theirs, track },
    )
  }

  const rebased = await rebaseOnto(bundle.dir, upstream, options)
  if (!rebased.ok) {
    const aborted = await abortRebase(bundle.dir, options)
    return failure(
      FAILURE.conflict,
      rebased.files.length > 0
        ? `${rebased.files.length} ${rebased.files.length === 1 ? 'file conflicts' : 'files conflict'} — rebase aborted`
        : 'rebase failed — aborted',
      { files: rebased.files, aborted, track, theirs, yours },
    )
  }

  const pushed = await push(bundle.dir, track, options)
  if (!pushed.ok) {
    return failure(
      FAILURE.pushRejected,
      (pushed.result.stderr || '').trim() || 'push was rejected after the rebase',
      { track, rebased: directions.ahead },
    )
  }

  return {
    ok: true,
    receipt: receipt('sync', bundle.name, from, await headSha(bundle.dir, options), {
      pushed: directions.ahead,
      pulled: directions.behind,
      rebased: directions.ahead,
      track,
    }),
  }
}

/**
 * The dry-run plan for one bundle: no refs, no working tree, no remote changes.
 *
 * @param {{ name: string, dir: string }} bundle - the bundle.
 * @param {object} inspection - inspected checkout.
 * @param {string} track - resolved track.
 * @param {object} options - git options.
 * @returns {Promise<object>} the plan or a refusal.
 */
async function planSync(bundle, inspection, track, options) {
  // A dry run fetches so the plan reflects the remote, but it never moves the
  // tree or pushes; the working directory and every remote stay untouched.
  const fetched = await fetch(bundle.dir, options)
  if (fetched.code !== 0) {
    return failure(FAILURE.fetchFailed, (fetched.stderr || '').trim() || 'fetch failed', { track })
  }

  const upstream = `origin/${track}`
  if ((await verifyRef(bundle.dir, upstream, options)) === null) {
    return failure(FAILURE.unknownTrack, `origin has no branch "${track}"`, { track })
  }

  const directions = await counts(bundle.dir, upstream, options)
  if (directions.ahead === 0 && directions.behind === 0) {
    return { ok: true, dryRun: true, plan: { action: 'nothing', track } }
  }
  if (directions.behind === 0) {
    return { ok: true, dryRun: true, plan: { action: 'push', pushed: directions.ahead, track } }
  }
  if (directions.ahead === 0) {
    return { ok: true, dryRun: true, plan: { action: 'pull', pulled: directions.behind, track } }
  }

  const yours = await revList(bundle.dir, `${upstream}..HEAD`, { limit: 50, ...options })
  const published = await publishedCommits(bundle.dir, yours, options)
  if (published.length > 0) {
    return failure(FAILURE.published, 'diverged with published commits — a merge is needed, not a rebase', {
      published,
      track,
    })
  }
  return {
    ok: true,
    dryRun: true,
    plan: { action: 'rebase', pulled: directions.behind, rebased: directions.ahead, track },
  }
}

/**
 * Switch one bundle to another track: fetch, switch (or create the tracking
 * branch), fast-forward when possible, and report what the move implies.
 *
 * @param {{ name: string, dir: string, track?: string | null }} bundle - the bundle.
 * @param {string} target - branch to switch to; local or `origin/<target>`.
 * @param {{ gitOptions?: object, signal?: AbortSignal }} [options] - git options.
 * @returns {Promise<object>} `{ ok: true, receipt, snapshot, reload }` or a failure.
 */
export async function switchBundle(bundle, target, { gitOptions = {}, signal } = {}) {
  const options = { ...gitOptions, signal }
  if (typeof target !== 'string' || target.trim() === '') {
    return failure(FAILURE.invalidTrack, 'a branch name is required')
  }
  const track = target.trim()

  const gated = await gate(bundle, { allowDetached: true, gitOptions, signal })
  if (gated.failure) return gated.failure
  const inspection = gated.inspection

  if (!(await validBranchName(bundle.dir, track, options))) {
    return failure(FAILURE.invalidTrack, `"${track}" is not a valid branch name`)
  }

  const wasTrack = bundle.track ?? (inspection.detached ? null : inspection.branch)
  if (inspection.branch === track) {
    return {
      ok: true,
      nothing: true,
      receipt: receipt('switch', bundle.name, inspection.head, inspection.head, {
        result: 'nothing',
        track,
        fromTrack: wasTrack,
      }),
      reload: { browser: false, host: false, dependencies: false },
      snapshot: null,
    }
  }

  const hasOrigin = inspection.remote !== null
  let fetchError = null
  if (hasOrigin) {
    const fetched = await fetch(bundle.dir, options)
    if (fetched.code !== 0) fetchError = (fetched.stderr || '').trim() || 'fetch failed'
  }

  const locals = await localBranches(bundle.dir, options)
  let switched
  if (locals.includes(track)) {
    switched = await switchBranch(bundle.dir, track, options)
  } else if (hasOrigin && (await remoteBranches(bundle.dir, options)).includes(`origin/${track}`)) {
    switched = await createTrackingBranch(bundle.dir, track, 'origin', options)
  } else {
    return failure(
      FAILURE.unknownTrack,
      fetchError === null
        ? `no local or remote branch named "${track}"`
        : `no local or remote branch named "${track}" (fetch failed: ${fetchError})`,
      { track, fetchError },
    )
  }
  if (!switched.ok) {
    return failure(FAILURE.unknown, (switched.result.stderr || '').trim() || `could not switch to "${track}"`, { track })
  }

  let fastForwarded = false
  if (hasOrigin && (await verifyRef(bundle.dir, `origin/${track}`, options)) !== null) {
    const moved = await fastForward(bundle.dir, `origin/${track}`, options)
    fastForwarded = moved.ok
  }

  const after = await inspect(bundle.dir, options)
  if (!after.ok) return unreadable(bundle, after)

  let reload = { browser: false, host: false, dependencies: false }
  try {
    reload = reloadClass(await diffNames(bundle.dir, inspection.head, after.head, options))
  } catch {
    // A path list is an extra; a diff failure must not turn a completed switch into a failure.
  }

  return {
    ok: true,
    receipt: receipt('switch', bundle.name, inspection.head, after.head, {
      track,
      fromTrack: wasTrack,
      fastForwarded,
    }),
    snapshot: {
      bundle: bundle.name,
      at: new Date().toISOString(),
      kind: 'switch',
      dir: bundle.dir,
      branch: inspection.branch,
      track: wasTrack,
      head: inspection.head,
      to: after.head,
    },
    reload,
  }
}

/**
 * Restore the tree recorded by an update or switch snapshot.
 *
 * @param {{ name: string, dir: string }} bundle - the bundle.
 * @param {{ branch?: string, head?: string, kind?: string }} snapshot - the recorded snapshot.
 * @param {{ gitOptions?: object, signal?: AbortSignal }} [options] - git options.
 * @returns {Promise<object>} `{ ok: true, receipt }` or a failure.
 */
export async function revertBundle(bundle, snapshot, { gitOptions = {}, signal } = {}) {
  const options = { ...gitOptions, signal }
  if (
    snapshot === null
    || typeof snapshot !== 'object'
    || typeof snapshot.head !== 'string'
    || typeof snapshot.branch !== 'string'
  ) {
    return failure(FAILURE.unknownSnapshot, 'no snapshot to restore for this bundle')
  }

  const gated = await gate(bundle, { allowDetached: true, gitOptions, signal })
  if (gated.failure) return gated.failure
  const inspection = gated.inspection
  const from = inspection.head

  if (inspection.branch !== snapshot.branch) {
    const switched = await switchBranch(bundle.dir, snapshot.branch, options)
    if (!switched.ok) {
      return failure(FAILURE.unknown, (switched.result.stderr || '').trim() || `could not switch to "${snapshot.branch}"`)
    }
  }

  const restored = await resetHard(bundle.dir, snapshot.head, options)
  if (!restored.ok) {
    return failure(FAILURE.unknown, (restored.result.stderr || '').trim() || 'could not restore the snapshot')
  }

  return {
    ok: true,
    receipt: receipt('revert', bundle.name, from, snapshot.head, { result: 'applied' }),
  }
}

/**
 * Run `sync` over several bundles, sequentially. A blocked row never stops the
 * next one (the design's "a morning").
 *
 * @param {Array<{ name: string, dir: string, track?: string | null }>} bundles - bundles in display order.
 * @param {{ dryRun?: boolean, gitOptions?: object, signal?: AbortSignal }} [options] - behaviour.
 * @returns {Promise<{ results: Array<object>, totals: { pushed: number, pulled: number, rebased: number }, ok: boolean }>} every row's outcome.
 */
export async function syncAll(bundles, { dryRun = false, gitOptions = {}, signal } = {}) {
  const results = []
  const totals = { pushed: 0, pulled: 0, rebased: 0 }

  for (const bundle of bundles) {
    let result
    try {
      result = await syncBundle(bundle, { dryRun, gitOptions, signal })
    } catch (error) {
      result = failure(FAILURE.unknown, error.message)
    }
    if (result.ok && result.receipt) {
      totals.pushed += result.receipt.pushed ?? 0
      totals.pulled += result.receipt.pulled ?? 0
      totals.rebased += result.receipt.rebased ?? 0
    }
    results.push({ name: bundle.name, ...result })
  }

  return { results, totals, ok: results.every((result) => result.ok) }
}
