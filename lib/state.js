/**
 * Viburnum's own state, stored with the profile and never in a bundle checkout.
 *
 * The file is JSON, written atomically (temp file + rename) because the page,
 * the tools and the CLI can touch it at once. Every function is pure except
 * `loadState` and `saveState`; the caller owns the read-modify-write window.
 *
 * Layout, version 2:
 *
 *   { version, bundles: { <package name>: <record> }, history: [], snapshots: [] }
 *
 * @module viburnum/lib/state
 */

import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { dshHome, profileName } from './profile.js'

/** Current state schema version. */
export const STATE_VERSION = 2

/** History entries kept. */
export const MAX_HISTORY = 50

/** Snapshots kept for reverting an update or a switch. */
export const MAX_SNAPSHOTS = 20

/** Age after which history and snapshots are pruned. */
export const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

/** File name inside the state directory. */
export const STATE_FILE = 'state.json'

/**
 * Where the state lives: `$VIBURNUM_STATE_DIR` for tests, else the profile's
 * `.viburnum` directory.
 *
 * @param {{ explicit?: string, env?: NodeJS.ProcessEnv, argv?: string[] }} [options] - overrides.
 * @returns {string} absolute state directory.
 */
export function stateDir(options = {}) {
  const explicit = options.env?.VIBURNUM_STATE_DIR?.trim()
  if (explicit) return resolve(explicit)

  const profileDir = options.env?.DSH_PROFILE_DIR?.trim()
  if (profileDir) return join(resolve(profileDir), '.viburnum')

  const home = dshHome(options.env)
  const name = profileName(options)
  return join(home, 'profiles', name, '.viburnum')
}

/** A fresh, empty state document. */
export function defaultState() {
  return { version: STATE_VERSION, bundles: {}, history: [], snapshots: [] }
}

/**
 * Bring any stored shape up to the current schema without dropping data it can
 * still understand.
 *
 * @param {unknown} raw - parsed JSON from disk.
 * @returns {object} a state document at the current version.
 */
export function migrate(raw) {
  const source = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const bundles = source.bundles !== null && typeof source.bundles === 'object' && !Array.isArray(source.bundles)
    ? source.bundles
    : {}
  const history = Array.isArray(source.history) ? source.history : []
  const snapshots = Array.isArray(source.snapshots) ? source.snapshots : []
  return { version: STATE_VERSION, bundles, history, snapshots }
}

/**
 * Read the state file.
 *
 * A missing file is an empty state. A corrupt file is reported and replaced by
 * an empty state in memory; nothing is written until the caller saves.
 *
 * @param {string} dir - state directory.
 * @returns {Promise<{ state: object, error: string | null }>} the state and a readable problem, if any.
 */
export async function loadState(dir) {
  const file = join(dir, STATE_FILE)
  let text
  try {
    text = await readFile(file, 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') return { state: defaultState(), error: null }
    return { state: defaultState(), error: `cannot read ${file}: ${error.message}` }
  }

  let raw
  try {
    raw = JSON.parse(text)
  } catch (error) {
    return { state: defaultState(), error: `state file is not valid JSON: ${error.message}` }
  }
  return { state: migrate(raw), error: null }
}

/**
 * Write the state atomically.
 *
 * @param {string} dir - state directory.
 * @param {object} state - state document.
 * @returns {Promise<void>} resolves once the new file is in place.
 */
export async function saveState(dir, state) {
  await mkdir(dir, { recursive: true })
  const file = join(dir, STATE_FILE)
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`
  try {
    await writeFile(temp, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
    await rename(temp, file)
  } catch (error) {
    await rm(temp, { force: true })
    throw error
  }
}

/**
 * Drop history and snapshots past retention. Bundles and their tracks stay.
 *
 * @param {object} state - state document.
 * @param {{ now?: number }} [options] - clock injection for tests.
 * @returns {object} a pruned copy.
 */
export function prune(state, { now = Date.now() } = {}) {
  const cutoff = now - MAX_AGE_MS
  const recent = (entry) => {
    const at = Date.parse(entry?.at)
    return Number.isFinite(at) ? at >= cutoff : true
  }
  return {
    ...state,
    version: STATE_VERSION,
    history: state.history.filter(recent).slice(-MAX_HISTORY),
    snapshots: state.snapshots.filter(recent).slice(-MAX_SNAPSHOTS),
  }
}

/**
 * Insert or replace one bundle record.
 *
 * @param {object} state - state document.
 * @param {string} name - package name.
 * @param {object} record - record fields to merge over the previous record.
 * @returns {object} a new state document.
 */
export function upsertBundle(state, name, record) {
  const previous = state.bundles[name] ?? {}
  return { ...state, bundles: { ...state.bundles, [name]: { ...previous, ...record } } }
}

/**
 * Append one history entry, keeping the configured retention.
 *
 * @param {object} state - state document.
 * @param {object} entry - history entry with an `at` timestamp.
 * @returns {object} a new state document.
 */
export function appendHistory(state, entry) {
  return { ...state, history: [...state.history, entry].slice(-MAX_HISTORY) }
}

/**
 * Append one snapshot, keeping the configured retention.
 *
 * @param {object} state - state document.
 * @param {object} snapshot - snapshot record with an `at` timestamp.
 * @returns {object} a new state document.
 */
export function appendSnapshot(state, snapshot) {
  return { ...state, snapshots: [...state.snapshots, snapshot].slice(-MAX_SNAPSHOTS) }
}
