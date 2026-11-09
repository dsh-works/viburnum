/**
 * Version and compatibility checks for the running harness and the linked
 * bundles: enough semver to answer "will this plugin accept the harness that is
 * running now?" without a dependency.
 *
 * @module viburnum/lib/version-check
 */

import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

/** Parse `major.minor.patch[-prerelease]`; null when it is not a version. */
export function parseVersion(text) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/u.exec(String(text ?? '').trim())
  if (match === null) return null
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ?? null,
  }
}

/** Compare two parsed versions: negative, zero or positive. */
export function compareVersions(left, right) {
  for (const key of ['major', 'minor', 'patch']) {
    if (left[key] !== right[key]) return left[key] - right[key]
  }
  if (left.prerelease === null && right.prerelease === null) return 0
  if (left.prerelease === null) return 1
  if (right.prerelease === null) return -1
  return left.prerelease < right.prerelease ? -1 : left.prerelease > right.prerelease ? 1 : 0
}

/** The upper bound a caret or tilde range excludes. */
function upperBound(base, operator) {
  if (operator === '~') {
    return { major: base.major, minor: base.minor + 1, patch: 0, prerelease: null }
  }
  if (base.major > 0) return { major: base.major + 1, minor: 0, patch: 0, prerelease: null }
  if (base.minor > 0) return { major: 0, minor: base.minor + 1, patch: 0, prerelease: null }
  return { major: 0, minor: 0, patch: base.patch + 1, prerelease: null }
}

/** Does one comparator clause accept the version? */
function accepts(parsed, clause) {
  const text = clause.trim()
  if (text === '' || text === '*' || text === 'latest') return true

  const match = /^(>=|<=|>|<|=|\^|~)?\s*(.+)$/u.exec(text)
  if (match === null) return true
  const operator = match[1] ?? '='
  const bound = parseVersion(match[2])
  if (bound === null) return true // A range shape we do not understand is not a warning.

  const order = compareVersions(parsed, bound)
  if (operator === '>=') return order >= 0
  if (operator === '>') return order > 0
  if (operator === '<=') return order <= 0
  if (operator === '<') return order < 0
  if (operator === '=') return order === 0
  if (operator === '^' || operator === '~') {
    if (order < 0) return false
    return compareVersions(parsed, upperBound(bound, operator)) < 0
  }
  return true
}

/**
 * Does a version satisfy a simple semver range (may contain `||` alternatives
 * and space-separated clauses)? Unknown shapes are accepted, so a scan never
 * invents a conflict.
 *
 * @param {string} version - running version.
 * @param {string} range - declared range.
 * @returns {boolean} true when the version is accepted.
 */
export function satisfiesRange(version, range) {
  const parsed = parseVersion(version)
  if (parsed === null) return true
  const alternatives = String(range ?? '').split('||')
  for (const alternative of alternatives) {
    const clauses = alternative.trim() === '' ? ['*'] : alternative.trim().split(/\s+/u)
    if (clauses.every((clause) => accepts(parsed, clause))) return true
  }
  return false
}

/**
 * Find the version of the harness that is actually running, by walking up from
 * the process entry point to the `@deepseek-ai/dsh` package manifest.
 *
 * @param {{ argv?: string[] }} [options] - process arguments override.
 * @returns {Promise<string | null>} the version, or null when it cannot be found.
 */
export async function runningDshVersion({ argv = process.argv } = {}) {
  const entry = argv[1]
  if (typeof entry !== 'string' || entry === '' || entry.startsWith('-')) return null

  let dir = dirname(entry)
  for (let depth = 0; depth < 8; depth += 1) {
    try {
      const pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'))
      if (pkg?.name === '@deepseek-ai/dsh' && typeof pkg.version === 'string') return pkg.version
    } catch {
      // Keep walking up.
    }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}
