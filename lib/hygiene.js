/**
 * The hygiene scan: what the profile cannot see about the workspace and shelf.
 *
 * It reads only. It reports duplicate checkouts of the same package, local
 * branches never merged into `main`, and trees dirty since the last commit; it
 * never deletes, moves or checks anything out.
 *
 * @module viburnum/lib/hygiene
 */

import { readdir, readFile, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { git, inspect } from './git.js'

/** Levels below each root that are scanned. */
export const DEFAULT_DEPTH = 3

/** Upper bound on checkouts one scan reports. */
export const MAX_CHECKOUTS = 40

/** Directories that never contain the checkouts this scan wants. */
const SKIP = new Set([
  '.cache',
  '.git',
  '.next',
  '.turbo',
  '.viburnum',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'profiles',
  'vendor',
])

/** `dir`, `file` or null when the path does not exist. */
async function pathType(path) {
  try {
    const info = await stat(path)
    return info.isDirectory() ? 'dir' : 'file'
  } catch {
    return null
  }
}

/** Read the package identity a duplicate check needs. */
async function readPackage(dir) {
  try {
    const pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'))
    if (typeof pkg?.name === 'string' && pkg.name.trim() !== '') {
      return { name: pkg.name.trim(), version: typeof pkg.version === 'string' ? pkg.version : null }
    }
  } catch {
    // Not a package.
  }
  return null
}

/** Local branches whose work is not in `main` (or the base branch). */
async function unmergedBranches(dir, base = 'main') {
  try {
    const result = await git(dir, ['branch', '--no-merged', base, '--format=%(refname:short)'], { timeoutMs: 5_000 })
    if (result.code !== 0) return []
    return result.stdout
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line !== '' && line !== base)
  } catch {
    return []
  }
}

/** Walk one root, recording checkouts and skipping noise. */
async function walk(root, depth, checkouts) {
  const stack = [[root, 0]]
  while (stack.length > 0 && checkouts.length < MAX_CHECKOUTS) {
    const [dir, level] = stack.pop()
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || SKIP.has(entry.name) || entry.name.startsWith('.')) continue
      const path = join(dir, entry.name)
      if (await pathType(join(path, '.git')) !== null) {
        checkouts.push(path)
        continue
      }
      if (level + 1 < depth) stack.push([path, level + 1])
    }
  }
}

/**
 * Scan the given roots and return findings plus the checkouts seen.
 *
 * @param {{ roots?: string[], depth?: number, now?: number }} [options] - scan request.
 * @returns {Promise<object>} `{ ok: true, scannedAt, roots, checkouts, findings }`.
 */
export async function scanHygiene({ roots = [], depth = DEFAULT_DEPTH, now = Date.now() } = {}) {
  const requested = [...new Set(roots
    .filter((root) => typeof root === 'string' && root.trim() !== '')
    .map((root) => resolve(root)))]
  const scanRoots = []
  for (const root of requested) {
    if (await pathType(root) === 'dir') scanRoots.push(root)
  }

  const dirs = []
  for (const root of scanRoots) await walk(root, depth, dirs)

  const checkouts = []
  for (const dir of dirs) {
    const info = await inspect(dir, { timeoutMs: 5_000 }).catch(() => null)
    if (info === null || info.ok !== true) {
      checkouts.push({ dir, name: null, version: null, branch: null, dirty: null, dirtyCount: 0, unmerged: [], error: 'not a readable git checkout' })
      continue
    }
    const pkg = await readPackage(dir)
    checkouts.push({
      dir,
      name: pkg?.name ?? null,
      version: pkg?.version ?? null,
      branch: info.branch ?? null,
      dirty: info.dirty === true,
      dirtyCount: info.dirtyCount ?? 0,
      unmerged: await unmergedBranches(dir),
      error: null,
    })
  }

  const findings = []
  const byName = new Map()
  for (const checkout of checkouts) {
    if (checkout.name === null) continue
    if (!byName.has(checkout.name)) byName.set(checkout.name, [])
    byName.get(checkout.name).push(checkout.dir)
  }
  for (const [name, dirs] of byName) {
    if (dirs.length > 1) {
      findings.push({
        kind: 'duplicate-checkout',
        name,
        dirs,
        suggestion: 'keep one linked checkout; archive or remove the other',
      })
    }
  }
  for (const checkout of checkouts) {
    const label = checkout.name ?? checkout.dir
    if (checkout.unmerged.length > 0) {
      findings.push({
        kind: 'unmerged-branch',
        name: label,
        dir: checkout.dir,
        branches: checkout.unmerged,
        suggestion: 'merge or delete each branch when its work is done',
      })
    }
    if (checkout.dirty === true) {
      findings.push({
        kind: 'dirty-checkout',
        name: label,
        dir: checkout.dir,
        dirtyCount: checkout.dirtyCount,
        suggestion: 'commit or stash the uncommitted changes',
      })
    }
  }

  return {
    ok: true,
    scannedAt: new Date(now).toISOString(),
    roots: scanRoots,
    checkouts,
    findings: findings.slice(0, 20),
  }
}
