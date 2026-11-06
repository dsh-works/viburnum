/**
 * Version evidence read from a checkout: changelog text, a suggested next
 * version, and the reload class a change implies.
 *
 * Nothing here writes a version. viburnum suggests a number, never edits
 * `package.json` (D24).
 *
 * @module viburnum/lib/version
 */

import { logSubjects, showFile } from './git.js'

/** Changelog excerpt kept in memory and in state. */
export const MAX_CHANGELOG_BYTES = 16 * 1024

/** A version heading in a CHANGELOG: `## 0.4.0`, `## [0.4.0] - 2026-01-01`, `## v0.4.0`. */
const VERSION_HEADING = /^##\s+\[?v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\]?/u

/**
 * Split a changelog into its version sections.
 *
 * @param {string} text - changelog markdown.
 * @returns {Array<{ version: string, body: string }>} sections in file order.
 */
export function parseChangelogSections(text) {
  if (typeof text !== 'string' || text === '') return []

  const sections = []
  let body = null
  for (const line of text.split(/\r?\n/u)) {
    if (line.startsWith('## ')) {
      const match = VERSION_HEADING.exec(line)
      if (match) {
        body = []
        sections.push({ version: match[1], body })
      } else {
        body = null
      }
      continue
    }
    if (line.startsWith('# ')) {
      body = null
      continue
    }
    if (body !== null) body.push(line)
  }

  return sections.map(({ version, body: lines }) => ({ version, body: lines.join('\n').trim() }))
}

/**
 * The section that names one version, or null.
 *
 * @param {string} text - changelog markdown.
 * @param {string} version - exact version, leading `v` accepted.
 * @returns {string | null} the section body.
 */
export function changelogSectionFor(text, version) {
  const wanted = String(version ?? '').replace(/^v/u, '')
  const section = parseChangelogSections(text).find((entry) => entry.version === wanted)
  return section ? section.body : null
}

/**
 * The first version section of a changelog.
 *
 * @param {string} text - changelog markdown.
 * @returns {string | null} the first section body.
 */
export function firstChangelogSection(text) {
  const [first] = parseChangelogSections(text)
  return first ? first.body : null
}

/**
 * Compare two numeric release versions.
 *
 * @param {string} left - version such as `0.4.0`.
 * @param {string} right - version such as `0.5.0`.
 * @returns {number} negative, zero or positive like a comparator.
 */
export function compareVersions(left, right) {
  const parse = (value) => String(value).replace(/^v/u, '').split(/[.+-]/u).slice(0, 3).map(Number)
  const a = parse(left)
  const b = parse(right)
  for (let index = 0; index < 3; index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0)
    if (difference !== 0) return difference
  }
  return 0
}

/**
 * The highest changelog version newer than the installed one, if there is one.
 *
 * This is the "next would be 0.5.0" hint: derived from the changelog, never
 * written anywhere.
 *
 * @param {string} text - changelog markdown.
 * @param {string} currentVersion - the installed version.
 * @returns {string | null} the suggested version, or null.
 */
export function suggestNextVersion(text, currentVersion) {
  let best = null
  for (const { version } of parseChangelogSections(text)) {
    if (compareVersions(version, currentVersion) <= 0) continue
    if (best === null || compareVersions(version, best) > 0) best = version
  }
  return best
}

/**
 * What one change implies for a running profile.
 *
 * @param {readonly string[]} paths - repository-relative changed paths.
 * @returns {{ browser: boolean, host: boolean, dependencies: boolean }} the reload classes.
 */
export function reloadClass(paths) {
  const result = { browser: false, host: false, dependencies: false }
  for (const raw of paths ?? []) {
    if (typeof raw !== 'string' || raw === '') continue
    const path = raw.replace(/\\/gu, '/')

    if (path === 'package.json') {
      result.dependencies = true
      continue
    }
    if (/^client[^/]*\.js$/u.test(path) || /^lib\/client[^/]*\.js$/u.test(path) || /^locale\//u.test(path)) {
      result.browser = true
      continue
    }
    if (path === 'index.js' || path.startsWith('lib/')) result.host = true
  }
  return result
}

/**
 * A human sentence for one reload class, localized by the caller's copy.
 *
 * @param {{ browser: boolean, host: boolean, dependencies: boolean }} classes - reload classes.
 * @returns {string} the sentence, or an empty string when nothing must reload.
 */
export function reloadLabel(classes) {
  const parts = []
  if (classes.host) parts.push('host half — restart `dsh web`')
  if (classes.browser) parts.push('browser half — refresh the page')
  if (classes.dependencies) parts.push('also: dependencies changed')
  return parts.join(' · ')
}

/**
 * Build the incoming changelog for one move: the target's changelog section,
 * its first section, the commit subjects in the range, or the target subject.
 *
 * @param {string} dir - checkout directory.
 * @param {{ from?: string | null, to?: string, version?: string | null, options?: object }} move - the revisions to describe.
 * @returns {Promise<string | null>} plain-text changelog, capped, or null.
 */
export async function buildChangelog(dir, { from = null, to = 'HEAD', version = null, options } = {}) {
  const file = await showFile(dir, to, 'CHANGELOG.md', options)
  if (file.ok) {
    const text = file.text.slice(0, MAX_CHANGELOG_BYTES)
    const named = version ? changelogSectionFor(text, version) : null
    if (named) return named
    const first = firstChangelogSection(text)
    if (first) return first
  }

  if (typeof from !== 'string' || from === '') return null
  const entries = await logSubjects(dir, `${from}..${to}`, { limit: 12, ...options })
  if (entries.length === 0) return null
  return entries.map(({ hash, subject }) => `${hash} ${subject}`).join('\n').slice(0, MAX_CHANGELOG_BYTES)
}
