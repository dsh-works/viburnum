/**
 * The git seam: one child process per call, never a shell, never stdin.
 *
 * Every function takes an absolute directory. Nothing here decides policy —
 * whether a fast-forward is allowed, when to rebase, what to do on a conflict —
 * that lives in the callers. This file only runs git and reports what happened.
 *
 * A command that times out or is aborted is killed and then **awaited**: the
 * promise settles only after the process exits, so no git process outlives the
 * call and no timer survives it.
 *
 * @module viburnum/lib/git
 */

import { spawn } from 'node:child_process'
import { access } from 'node:fs/promises'
import { resolve as resolvePath } from 'node:path'

/** Bound on one git process; a hung fetch must not hold a profile forever. */
export const DEFAULT_TIMEOUT_MS = 20_000

/** Output kept from one command; progress chatter is discarded beyond this. */
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024

/** Environment every child gets: no prompts, no optional locks, stable output. */
const BASE_ENV = {
  ...process.env,
  GIT_TERMINAL_PROMPT: '0',
  GIT_OPTIONAL_LOCKS: '0',
  LC_ALL: 'C',
}

/** A git command that was expected to succeed and did not. */
export class GitError extends Error {
  /**
   * @param {string[]} args - the arguments that failed.
   * @param {{ code: number | null, signal?: string | null, stdout: string, stderr: string }} result - what git said.
   */
  constructor(args, result) {
    const detail = result.stderr.trim() || result.stdout.trim() || 'no output'
    super(`git ${args.join(' ')} failed (${result.code ?? result.signal ?? 'unknown'}): ${detail}`)
    this.name = 'GitError'
    this.code = 'VIB_GIT_FAILED'
    this.args = args
    this.result = result
  }
}

/** A git command that was killed because it outlived its bound. */
export class GitTimeoutError extends Error {
  /**
   * @param {string[]} args - the arguments that timed out.
   * @param {number} timeoutMs - the bound that expired.
   */
  constructor(args, timeoutMs) {
    super(`git ${args.join(' ')} timed out after ${timeoutMs}ms`)
    this.name = 'GitTimeoutError'
    this.code = 'VIB_GIT_TIMEOUT'
    this.args = args
  }
}

/** A git command that was killed because its caller went away. */
export class GitAbortedError extends Error {
  /** @param {string[]} args - the arguments that were cancelled. */
  constructor(args) {
    super(`git ${args.join(' ')} was cancelled`)
    this.name = 'GitAbortedError'
    this.code = 'VIB_GIT_ABORTED'
    this.args = args
  }
}

/**
 * Run one git process to quiescence.
 *
 * Resolves with the settled process result. A timeout or an abort kills the
 * child, and the promise settles only once it has exited.
 *
 * @param {string} cwd - absolute directory to run in.
 * @param {string[]} args - git arguments.
 * @param {{ timeoutMs?: number, env?: Record<string, string>, signal?: AbortSignal }} [options] - overrides.
 * @returns {Promise<{ code: number | null, signal: string | null, stdout: string, stderr: string, truncated: boolean }>} the settled process.
 */
export function git(cwd, args, { timeoutMs = DEFAULT_TIMEOUT_MS, env, signal } = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn('git', args, {
      cwd,
      env: env ? { ...BASE_ENV, ...env } : BASE_ENV,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    let truncated = false
    let timedOut = false
    let aborted = false
    let settled = false
    let killTimer

    const kill = () => {
      child.kill()
      // A process that ignores TERM (or a wrapper that survives it) gets one
      // escalation; the close handler still decides when the call settles.
      killTimer = setTimeout(() => child.kill('SIGKILL'), 2_000)
    }

    const timer = timeoutMs > 0
      ? setTimeout(() => {
        timedOut = true
        kill()
      }, timeoutMs)
      : undefined

    const onAbort = () => {
      aborted = true
      kill()
    }
    if (signal) {
      if (signal.aborted) onAbort()
      else signal.addEventListener('abort', onAbort, { once: true })
    }

    const cleanup = () => {
      if (timer) clearTimeout(timer)
      if (killTimer) clearTimeout(killTimer)
      signal?.removeEventListener('abort', onAbort)
    }

    const collect = (stream, chunk) => {
      const text = String(chunk)
      if (stream.length + text.length > MAX_OUTPUT_BYTES) {
        truncated = true
        const room = Math.max(0, MAX_OUTPUT_BYTES - stream.length)
        if (room > 0) stream += text.slice(0, room)
      } else {
        stream += text
      }
      return stream
    }

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => { stdout = collect(stdout, chunk) })
    child.stderr.on('data', (chunk) => { stderr = collect(stderr, chunk) })

    child.on('error', (error) => {
      if (settled) return
      settled = true
      cleanup()
      rejectPromise(error)
    })

    child.on('close', (code, signalName) => {
      if (settled) return
      settled = true
      cleanup()
      if (timedOut) {
        rejectPromise(new GitTimeoutError(args, timeoutMs))
        return
      }
      if (aborted) {
        rejectPromise(new GitAbortedError(args))
        return
      }
      resolvePromise({ code, signal: signalName, stdout, stderr, truncated })
    })
  })
}

/**
 * Run a git command that must succeed, and return its stdout.
 *
 * @param {string} cwd - absolute directory.
 * @param {string[]} args - git arguments.
 * @param {{ timeoutMs?: number, env?: Record<string, string>, signal?: AbortSignal }} [options] - overrides.
 * @returns {Promise<string>} trimmed stdout.
 * @throws {GitError} when git exits non-zero.
 */
export async function must(cwd, args, options) {
  const result = await git(cwd, args, options)
  if (result.code !== 0) throw new GitError(args, result)
  return result.stdout.trim()
}

/**
 * Read what a checkout is, without touching the network.
 *
 * @param {string} dir - directory that should be inside a working tree.
 * @param {{ timeoutMs?: number, env?: Record<string, string>, signal?: AbortSignal }} [options] - overrides.
 * @returns {Promise<
 *   { ok: false, reason: 'missing' | 'not-a-repo' | 'no-commits', error: string } |
 *   { ok: true, root: string, head: string, branch: string, detached: boolean, dirty: boolean, dirtyCount: number, remote: string | null }
 * >} the checkout.
 */
export async function inspect(dir, options) {
  try {
    await access(dir)
  } catch {
    return { ok: false, reason: 'missing', error: `directory not found: ${dir}` }
  }

  const top = await git(dir, ['rev-parse', '--show-toplevel'], options)
  if (top.code !== 0) return { ok: false, reason: 'not-a-repo', error: top.stderr.trim() }

  const head = await git(dir, ['rev-parse', '--verify', 'HEAD'], options)
  if (head.code !== 0) return { ok: false, reason: 'no-commits', error: head.stderr.trim() }

  const [branch, status, remote] = await Promise.all([
    git(dir, ['rev-parse', '--abbrev-ref', 'HEAD'], options),
    git(dir, ['status', '--porcelain'], options),
    git(dir, ['remote', 'get-url', 'origin'], options),
  ])

  const branchName = branch.code === 0 ? branch.stdout.trim() : ''
  const porcelain = status.code === 0 ? status.stdout.trim() : ''
  return {
    ok: true,
    root: top.stdout.trim(),
    head: head.stdout.trim(),
    branch: branchName,
    detached: branchName === 'HEAD' || branchName === '',
    dirty: porcelain.length > 0,
    dirtyCount: porcelain === '' ? 0 : porcelain.split(/\r?\n/u).length,
    remote: remote.code === 0 ? remote.stdout.trim() : null,
  }
}

/**
 * Whether a rebase is in progress in this checkout.
 *
 * @param {string} dir - absolute directory.
 * @param {{ timeoutMs?: number, env?: Record<string, string>, signal?: AbortSignal }} [options] - overrides.
 * @returns {Promise<boolean>} true while a rebase has work queued in `.git`.
 */
export async function rebaseInProgress(dir, options) {
  for (const name of ['rebase-merge', 'rebase-apply']) {
    const result = await git(dir, ['rev-parse', '--git-path', name], options)
    if (result.code !== 0) continue
    const path = result.stdout.trim()
    if (path === '') continue
    try {
      await access(resolvePath(dir, path))
      return true
    } catch {
      // The path does not exist, so this kind of rebase is not running.
    }
  }
  return false
}

/**
 * How far HEAD is from an upstream, in both directions.
 *
 * @param {string} dir - absolute directory.
 * @param {string} upstream - e.g. `origin/main`.
 * @param {{ timeoutMs?: number, env?: Record<string, string>, signal?: AbortSignal }} [options] - overrides.
 * @returns {Promise<{ behind: number, ahead: number }>} commit counts.
 */
export async function counts(dir, upstream, options) {
  const out = await must(dir, ['rev-list', '--left-right', '--count', `${upstream}...HEAD`], options)
  const [behind = 0, ahead = 0] = out.split(/\s+/u).map(Number)
  return { behind: Number.isFinite(behind) ? behind : 0, ahead: Number.isFinite(ahead) ? ahead : 0 }
}

/**
 * Commit ids in a revision range, newest first.
 *
 * @param {string} dir - absolute directory.
 * @param {string} range - e.g. `origin/main..HEAD`.
 * @param {{ limit?: number, timeoutMs?: number, env?: Record<string, string>, signal?: AbortSignal }} [options] - limit defaults to 50.
 * @returns {Promise<string[]>} full commit ids.
 */
export async function revList(dir, range, { limit = 50, ...options } = {}) {
  const out = await must(dir, ['rev-list', `--max-count=${limit}`, range], options)
  return out === '' ? [] : out.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean)
}

/**
 * Short log lines with subjects.
 *
 * @param {string} dir - absolute directory.
 * @param {string} range - e.g. `origin/main..HEAD`, or `HEAD` alone.
 * @param {{ limit?: number, timeoutMs?: number, env?: Record<string, string>, signal?: AbortSignal }} [options] - limit defaults to 50.
 * @returns {Promise<Array<{ hash: string, subject: string }>>} parsed log entries.
 */
export async function logSubjects(dir, range, { limit = 50, ...options } = {}) {
  const out = await must(dir, ['log', '--no-merges', `--max-count=${limit}`, '--format=%h %s', range], options)
  if (out === '') return []
  return out.split(/\r?\n/u).map((line) => {
    const space = line.indexOf(' ')
    return space === -1
      ? { hash: line.trim(), subject: '' }
      : { hash: line.slice(0, space).trim(), subject: line.slice(space + 1).trim() }
  })
}

/**
 * Update remote-tracking refs. Never touches the working tree.
 *
 * @param {string} dir - absolute directory.
 * @param {{ timeoutMs?: number, env?: Record<string, string>, signal?: AbortSignal }} [options] - overrides.
 * @returns {Promise<{ code: number | null, signal: string | null, stdout: string, stderr: string, truncated: boolean }>} the fetch result.
 */
export function fetch(dir, options) {
  return git(dir, ['fetch', '--prune', '--tags', 'origin'], options)
}

/**
 * Move the current branch forward to an upstream. Refuses anything but a fast-forward.
 *
 * @param {string} dir - absolute directory.
 * @param {string} upstream - e.g. `origin/main`.
 * @param {{ timeoutMs?: number, env?: Record<string, string>, signal?: AbortSignal }} [options] - overrides.
 * @returns {Promise<{ ok: boolean, result: Awaited<ReturnType<typeof git>> }>} whether it moved.
 */
export async function fastForward(dir, upstream, options) {
  const result = await git(dir, ['merge', '--ff-only', upstream], options)
  return { ok: result.code === 0, result }
}

/**
 * Publish HEAD to a remote branch. Never forces.
 *
 * @param {string} dir - absolute directory.
 * @param {string} branch - branch name on `origin`.
 * @param {{ timeoutMs?: number, env?: Record<string, string>, signal?: AbortSignal }} [options] - overrides.
 * @returns {Promise<{ ok: boolean, result: Awaited<ReturnType<typeof git>> }>} whether it pushed.
 */
export async function push(dir, branch, options) {
  const result = await git(dir, ['push', 'origin', `HEAD:refs/heads/${branch}`], options)
  return { ok: result.code === 0, result }
}

/**
 * Replay local commits onto an upstream. The caller owns the conflict decision:
 * a failed rebase is reported with the conflicted paths, not aborted here.
 *
 * @param {string} dir - absolute directory.
 * @param {string} upstream - e.g. `origin/main`.
 * @param {{ timeoutMs?: number, env?: Record<string, string>, signal?: AbortSignal }} [options] - overrides.
 * @returns {Promise<{ ok: true } | { ok: false, files: string[], result: Awaited<ReturnType<typeof git>> }>} the rebase outcome.
 */
export async function rebaseOnto(dir, upstream, options) {
  const result = await git(dir, ['rebase', upstream], options)
  if (result.code === 0) return { ok: true }

  const conflicted = await git(dir, ['diff', '--name-only', '--diff-filter=U'], options)
  const files = conflicted.code === 0
    ? conflicted.stdout.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean)
    : []
  return { ok: false, files, result }
}

/**
 * Abort an in-progress rebase, returning the branch to its pre-rebase state.
 *
 * @param {string} dir - absolute directory.
 * @param {{ timeoutMs?: number, env?: Record<string, string>, signal?: AbortSignal }} [options] - overrides.
 * @returns {Promise<boolean>} whether the abort succeeded.
 */
export async function abortRebase(dir, options) {
  const result = await git(dir, ['rebase', '--abort'], options)
  return result.code === 0
}

/**
 * The unmerged paths a stopped rebase is asking about.
 *
 * @param {string} dir - absolute directory.
 * @param {{ timeoutMs?: number, env?: Record<string, string>, signal?: AbortSignal }} [options] - overrides.
 * @returns {Promise<string[]>} conflicted paths.
 */
export async function conflictFiles(dir, options) {
  const result = await git(dir, ['diff', '--name-only', '--diff-filter=U'], options)
  if (result.code !== 0) return []
  return result.stdout.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean)
}

/**
 * Continue a stopped rebase, using a no-op editor.
 *
 * @param {string} dir - absolute directory.
 * @param {{ timeoutMs?: number, env?: Record<string, string>, signal?: AbortSignal }} [options] - overrides.
 * @returns {Promise<{ ok: true } | { ok: false, files: string[], result: object }>} the outcome.
 */
export async function rebaseContinue(dir, options) {
  const result = await git(dir, ['-c', 'core.editor=true', 'rebase', '--continue'], options)
  if (result.code === 0) return { ok: true }
  return { ok: false, files: await conflictFiles(dir, options), result }
}

/**
 * Stage one resolved path.
 *
 * @param {string} dir - absolute directory.
 * @param {string} path - repository-relative path.
 * @param {{ timeoutMs?: number, env?: Record<string, string>, signal?: AbortSignal }} [options] - overrides.
 * @returns {Promise<boolean>} whether the path was staged.
 */
export async function addPath(dir, path, options) {
  const result = await git(dir, ['add', '--', path], options)
  return result.code === 0
}

/**
 * Read one merge stage of a path: 1 = base, 2 = ours, 3 = theirs.
 *
 * @param {string} dir - absolute directory.
 * @param {1 | 2 | 3} stage - the stage number.
 * @param {string} path - repository-relative path.
 * @param {{ timeoutMs?: number, env?: Record<string, string>, signal?: AbortSignal }} [options] - overrides.
 * @returns {Promise<{ ok: true, text: string } | { ok: false }>} the stage content.
 */
export async function showStage(dir, stage, path, options) {
  const result = await git(dir, ['show', `:${stage}:${path}`], options)
  return result.code === 0 ? { ok: true, text: result.stdout } : { ok: false }
}

/**
 * Merge three files with git's union strategy and return the merged text.
 *
 * @param {string} dir - cwd for git.
 * @param {string} ours - absolute path to the "ours" file.
 * @param {string} base - absolute path to the base file.
 * @param {string} theirs - absolute path to the "theirs" file.
 * @param {{ timeoutMs?: number, env?: Record<string, string>, signal?: AbortSignal }} [options] - overrides.
 * @returns {Promise<{ ok: true, text: string } | { ok: false, result: object }>} the merged text.
 */
export async function mergeUnionFiles(dir, ours, base, theirs, options) {
  const result = await git(dir, ['merge-file', '--union', '-p', ours, base, theirs], options)
  return result.code === 0 ? { ok: true, text: result.stdout } : { ok: false, result }
}

/**
 * Remote-tracking branches without the symbolic HEAD.
 *
 * @param {string} dir - absolute directory.
 * @param {{ timeoutMs?: number, env?: Record<string, string>, signal?: AbortSignal }} [options] - overrides.
 * @returns {Promise<string[]>} e.g. `['origin/dev', 'origin/main']`.
 */
export async function remoteBranches(dir, options) {
  const out = await must(dir, ['for-each-ref', '--sort=refname', '--format=%(refname:short)', 'refs/remotes'], options)
  return out === ''
    ? []
    : out.split(/\r?\n/u)
      .map((line) => line.trim())
      // A symbolic remote HEAD shortens to the bare remote name (`origin`).
      .filter((name) => name.includes('/') && !name.endsWith('/HEAD'))
}

/**
 * Local branch names.
 *
 * @param {string} dir - absolute directory.
 * @param {{ timeoutMs?: number, env?: Record<string, string>, signal?: AbortSignal }} [options] - overrides.
 * @returns {Promise<string[]>} branch names.
 */
export async function localBranches(dir, options) {
  const out = await must(dir, ['for-each-ref', '--sort=refname', '--format=%(refname:short)', 'refs/heads'], options)
  return out === '' ? [] : out.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean)
}

/**
 * Switch to an existing local branch.
 *
 * @param {string} dir - absolute directory.
 * @param {string} branch - local branch name.
 * @param {{ timeoutMs?: number, env?: Record<string, string>, signal?: AbortSignal }} [options] - overrides.
 * @returns {Promise<{ ok: boolean, result: Awaited<ReturnType<typeof git>> }>} whether it switched.
 */
export async function switchBranch(dir, branch, options) {
  const result = await git(dir, ['switch', branch], options)
  return { ok: result.code === 0, result }
}

/**
 * Create a local branch that tracks a remote branch, and switch to it.
 *
 * @param {string} dir - absolute directory.
 * @param {string} branch - branch name, same on `origin`.
 * @param {string} [remote] - remote name, defaults to `origin`.
 * @param {{ timeoutMs?: number, env?: Record<string, string>, signal?: AbortSignal }} [options] - overrides.
 * @returns {Promise<{ ok: boolean, result: Awaited<ReturnType<typeof git>> }>} whether it switched.
 */
export async function createTrackingBranch(dir, branch, remote = 'origin', options) {
  const result = await git(dir, ['switch', '-c', branch, '--track', `${remote}/${branch}`], options)
  return { ok: result.code === 0, result }
}

/**
 * Move HEAD and the working tree to a recorded commit.
 *
 * @param {string} dir - absolute directory.
 * @param {string} sha - commit to restore.
 * @param {{ timeoutMs?: number, env?: Record<string, string>, signal?: AbortSignal }} [options] - overrides.
 * @returns {Promise<{ ok: boolean, result: Awaited<ReturnType<typeof git>> }>} whether it moved.
 */
export async function resetHard(dir, sha, options) {
  const result = await git(dir, ['reset', '--hard', sha], options)
  return { ok: result.code === 0, result }
}

/**
 * Remote branches (other than the track) that contain one commit.
 *
 * @param {string} dir - absolute directory.
 * @param {string} sha - commit to look for.
 * @param {{ timeoutMs?: number, env?: Record<string, string>, signal?: AbortSignal }} [options] - overrides.
 * @returns {Promise<string[]>} remote branch names such as `origin/dev`.
 */
export async function remoteRefsContaining(dir, sha, options) {
  const result = await git(dir, ['branch', '-r', '--contains', sha, '--format=%(refname:short)'], options)
  if (result.code !== 0) return []
  return result.stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    // A symbolic remote HEAD shortens to the bare remote name (`origin`).
    .filter((name) => name.includes('/') && !name.endsWith('/HEAD'))
}

/**
 * Whether one commit is an ancestor of another.
 *
 * @param {string} dir - absolute directory.
 * @param {string} ancestor - older commit.
 * @param {string} descendant - newer commit.
 * @param {{ timeoutMs?: number, env?: Record<string, string>, signal?: AbortSignal }} [options] - overrides.
 * @returns {Promise<boolean>} true when `ancestor` is contained in `descendant`.
 */
export async function isAncestor(dir, ancestor, descendant, options) {
  const result = await git(dir, ['merge-base', '--is-ancestor', ancestor, descendant], options)
  return result.code === 0
}

/**
 * Changed paths between two revisions.
 *
 * @param {string} dir - absolute directory.
 * @param {string} from - older revision.
 * @param {string} to - newer revision.
 * @param {{ timeoutMs?: number, env?: Record<string, string>, signal?: AbortSignal }} [options] - overrides.
 * @returns {Promise<string[]>} repository-relative paths.
 */
export async function diffNames(dir, from, to, options) {
  const out = await must(dir, ['diff', '--name-only', from, to], options)
  return out === '' ? [] : out.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean)
}

/**
 * Read one file at one revision, capped to keep a large file out of memory.
 *
 * @param {string} dir - absolute directory.
 * @param {string} rev - revision such as `HEAD` or `origin/main`.
 * @param {string} file - repository-relative path.
 * @param {{ timeoutMs?: number, env?: Record<string, string>, signal?: AbortSignal }} [options] - overrides.
 * @returns {Promise<{ ok: true, text: string } | { ok: false, error: string }>} the file or why it is absent.
 */
export async function showFile(dir, rev, file, options) {
  const result = await git(dir, ['show', `${rev}:${file}`], options)
  if (result.code !== 0) return { ok: false, error: result.stderr.trim() }
  return { ok: true, text: result.stdout }
}

/**
 * The commit id of a ref, or null when it does not exist.
 *
 * @param {string} dir - absolute directory.
 * @param {string} ref - ref name such as `origin/main`.
 * @param {{ timeoutMs?: number, env?: Record<string, string>, signal?: AbortSignal }} [options] - overrides.
 * @returns {Promise<string | null>} full commit id or null.
 */
export async function verifyRef(dir, ref, options) {
  const result = await git(dir, ['rev-parse', '--verify', '--quiet', ref], options)
  return result.code === 0 ? result.stdout.trim() : null
}

/**
 * The current commit id.
 *
 * @param {string} dir - absolute directory.
 * @param {{ timeoutMs?: number, env?: Record<string, string>, signal?: AbortSignal }} [options] - overrides.
 * @returns {Promise<string>} full commit id.
 */
export function headSha(dir, options) {
  return must(dir, ['rev-parse', 'HEAD'], options)
}

/**
 * Whether a name is a valid branch name for git.
 *
 * @param {string} dir - absolute directory.
 * @param {string} name - candidate branch name.
 * @param {{ timeoutMs?: number, env?: Record<string, string>, signal?: AbortSignal }} [options] - overrides.
 * @returns {Promise<boolean>} true when git accepts the name.
 */
export async function validBranchName(dir, name, options) {
  const result = await git(dir, ['check-ref-format', '--branch', name], options)
  return result.code === 0
}
