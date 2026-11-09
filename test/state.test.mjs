/**
 * State resolution, atomic persistence, migration and retention.
 */

import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'

import {
  appendHistory,
  appendSnapshot,
  defaultState,
  loadState,
  MAX_HISTORY,
  MAX_SNAPSHOTS,
  migrate,
  prune,
  saveState,
  stateDir,
  upsertBundle,
} from '../lib/state.js'

test('the state directory is overridable and otherwise lives with the profile', () => {
  assert.equal(
    stateDir({ env: { VIBURNUM_STATE_DIR: 'C:/tmp/state' } }),
    resolve('C:/tmp/state'),
  )
  assert.equal(
    stateDir({ env: { DSH_PROFILE_DIR: 'C:/profiles/web' } }),
    resolve('C:/profiles/web', '.viburnum'),
  )
  assert.equal(
    stateDir({ env: { DSH_HOME: 'C:/dsh', DSH_PROFILE: 'work' }, argv: [] }),
    resolve('C:/dsh', 'profiles', 'work', '.viburnum'),
  )
})

test('a missing state file is an empty state without an error', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'viburnum-state-'))
  t.after(() => rm(dir, { recursive: true, force: true }))

  const loaded = await loadState(dir)
  assert.equal(loaded.error, null)
  assert.deepEqual(loaded.state, defaultState())
})

test('save and load round-trip atomically', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'viburnum-state-'))
  t.after(() => rm(dir, { recursive: true, force: true }))

  const state = upsertBundle(defaultState(), 'dsh-plugin-a', { track: 'dev', head: 'abc123' })
  await saveState(dir, state)

  const loaded = await loadState(dir)
  assert.equal(loaded.error, null)
  assert.deepEqual(loaded.state.bundles['dsh-plugin-a'], { track: 'dev', head: 'abc123' })

  const names = await readdir(dir)
  assert.ok(!names.some((name) => name.endsWith('.tmp')), 'no temporary file survives the rename')
  assert.match(await readFile(join(dir, 'state.json'), 'utf8'), /"version": 3/u)
})

test('a corrupt state file reports the problem and falls back to empty', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'viburnum-state-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  await writeFile(join(dir, 'state.json'), 'not json at all', 'utf8')

  const loaded = await loadState(dir)
  assert.match(loaded.error, /not valid JSON/u)
  assert.deepEqual(loaded.state, defaultState())
})

test('older shapes migrate without losing what is still understood', () => {
  const migrated = migrate({
    version: 1,
    bundles: { 'dsh-plugin-a': { track: 'main' } },
    history: [{ bundle: 'dsh-plugin-a', kind: 'sync' }],
  })
  assert.equal(migrated.version, 3)
  assert.deepEqual(migrated.bundles, { 'dsh-plugin-a': { track: 'main' } })
  assert.deepEqual(migrated.history, [{ bundle: 'dsh-plugin-a', kind: 'sync' }])
  assert.deepEqual(migrated.snapshots, [])
  assert.deepEqual(migrated.timeline, [])
  assert.deepEqual(migrated.seen, {})
  assert.deepEqual(migrated.settings, {})
  assert.equal(migrated.dshVersion, null)
})

test('retention prunes old entries and caps both lists', () => {
  const now = Date.parse('2026-11-06T12:00:00Z')
  const old = new Date(now - 40 * 24 * 60 * 60 * 1000).toISOString()
  const fresh = new Date(now - 60 * 60 * 1000).toISOString()

  const state = {
    ...defaultState(),
    history: [
      { at: old, kind: 'sync' },
      ...Array.from({ length: MAX_HISTORY + 5 }, () => ({ at: fresh, kind: 'check' })),
    ],
    snapshots: Array.from({ length: MAX_SNAPSHOTS + 3 }, () => ({ at: fresh })),
  }

  const pruned = prune(state, { now })
  assert.equal(pruned.history.length, MAX_HISTORY)
  assert.equal(pruned.snapshots.length, MAX_SNAPSHOTS)
  assert.equal(pruned.history.some((entry) => entry.at === old), false)
})

test('history and snapshots append with their caps', () => {
  let state = defaultState()
  for (let index = 0; index < MAX_HISTORY + 2; index += 1) {
    state = appendHistory(state, { at: new Date(2026, 10, 6, 0, index).toISOString(), kind: 'check' })
  }
  assert.equal(state.history.length, MAX_HISTORY)

  for (let index = 0; index < MAX_SNAPSHOTS + 2; index += 1) {
    state = appendSnapshot(state, { at: new Date(2026, 10, 6, 1, index).toISOString(), kind: 'update' })
  }
  assert.equal(state.snapshots.length, MAX_SNAPSHOTS)

  state = upsertBundle(state, 'dsh-plugin-a', { track: 'dev' })
  state = upsertBundle(state, 'dsh-plugin-a', { head: 'abc' })
  assert.deepEqual(state.bundles['dsh-plugin-a'], { track: 'dev', head: 'abc' })
})
