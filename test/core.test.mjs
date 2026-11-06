/**
 * The core: state hydration, check passes, queued moves, receipts and tracks.
 */

import assert from 'node:assert/strict'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { createCore, OWN_PACKAGE } from '../lib/core.js'
import { makeWorld, run } from './fixtures.mjs'

/** Build a world, a state directory and a core that watches both clones. */
async function setup(t) {
  const world = await makeWorld(t)
  const stateDirectory = await mkdtemp(join(tmpdir(), 'viburnum-core-'))
  t.after(() => rm(stateDirectory, { recursive: true, force: true }))

  const env = { DSH_HOME: world.root, DSH_PROFILE: 'web', VIBURNUM_STATE_DIR: stateDirectory }
  const bundleSource = async () => ({
    profileDir: join(world.root, 'profiles', 'web'),
    bundles: [
      { name: 'dsh-plugin-laptop', dir: world.laptop },
      { name: 'dsh-plugin-work', dir: world.work },
    ],
  })
  const core = createCore({ bundleSource, env, argv: [] })
  return { world, stateDirectory, core }
}

test('the core hydrates cached rows from the state file', async (t) => {
  const { world, core } = await setup(t)
  await core.load()
  assert.equal(core.snapshot().rows.length, 0)

  const checked = await core.refresh()
  assert.equal(checked.rows.length, 2)
  assert.equal(checked.dot, 'green')
  assert.ok(typeof checked.checkedAt === 'string')
  assert.deepEqual(checked.rows.map((row) => row.status), ['current', 'current'])

  const hydrated = createCore({
    bundleSource: async () => ({ profileDir: world.root, bundles: [] }),
    env: { DSH_HOME: world.root, DSH_PROFILE: 'web', VIBURNUM_STATE_DIR: core.stateDirectory },
    argv: [],
  })
  await hydrated.load()
  assert.equal(hydrated.snapshot().rows.length, 2)
  assert.equal(hydrated.snapshot().rows[0].status, 'current')
})

test('update records a receipt and a snapshot, and revert restores it', async (t) => {
  const { world, stateDirectory, core } = await setup(t)
  await core.load()
  const before = await world.head(world.work)

  await world.commit(world.laptop, 'a.txt', 'a\n', 'laptop one')
  await world.push(world.laptop)

  const updated = await core.update('dsh-plugin-work')
  assert.equal(updated.ok, true)
  assert.equal(updated.receipt.kind, 'update')

  const state = JSON.parse(await readFile(join(stateDirectory, 'state.json'), 'utf8'))
  assert.equal(state.history.length, 1)
  assert.equal(state.snapshots.length, 1)

  const reverted = await core.revert('dsh-plugin-work')
  assert.equal(reverted.ok, true)
  assert.equal(await world.head(world.work), before)
})

test('sync over all bundles skips Viburnum itself', async (t) => {
  const { world, stateDirectory } = await setup(t)

  const core = createCore({
    bundleSource: async () => ({
      profileDir: world.root,
      bundles: [
        { name: 'dsh-plugin-laptop', dir: world.laptop },
        { name: 'dsh-plugin-work', dir: world.work },
        { name: OWN_PACKAGE, dir: world.laptop },
      ],
    }),
    env: { DSH_HOME: world.root, DSH_PROFILE: 'web', VIBURNUM_STATE_DIR: stateDirectory },
    argv: [],
  })

  await world.commit(world.laptop, 'a.txt', 'a\n', 'laptop one')
  await world.push(world.laptop)

  const batch = await core.sync()
  assert.equal(batch.results.length, 2, 'the own row is skipped')
  assert.deepEqual(batch.results.map((row) => row.name), ['dsh-plugin-laptop', 'dsh-plugin-work'])
  assert.equal(batch.totals.pulled, 1)
  assert.equal(await world.head(world.work), await world.head(world.laptop))
})

test('switch records the new track and revert restores the old one', async (t) => {
  const { world, core } = await setup(t)
  await core.load()

  await run(world.laptop, ['switch', '-c', 'dev'])
  await world.commit(world.laptop, 'client.js', 'void 0\n', 'dev change')
  await run(world.laptop, ['push', '-u', 'origin', 'dev'])

  const switched = await core.switch('dsh-plugin-work', 'dev')
  assert.equal(switched.ok, true)
  assert.equal(await world.branch(world.work), 'dev')

  const refreshed = await core.refresh()
  const workRow = refreshed.rows.find((row) => row.name === 'dsh-plugin-work')
  assert.equal(workRow.track, 'dev')

  const reverted = await core.revert('dsh-plugin-work')
  assert.equal(reverted.ok, true)
  assert.equal(await world.branch(world.work), 'main')

  const after = await core.refresh()
  assert.equal(after.rows.find((row) => row.name === 'dsh-plugin-work').track, 'main')
})

test('tracks are listed for one bundle', async (t) => {
  const { world, core } = await setup(t)
  await run(world.laptop, ['switch', '-c', 'dev'])
  await run(world.laptop, ['push', '-u', 'origin', 'dev'])
  await world.fetch(world.work)

  assert.deepEqual(await core.tracks('dsh-plugin-work'), ['dev', 'main'])
  await assert.rejects(core.tracks('nope'), (error) => error.code === 'unknown-bundle')
})

test('a failed fetch keeps the previous row marked stale', async (t) => {
  const { world, core } = await setup(t)
  await core.load()
  await core.refresh()

  await run(world.work, ['remote', 'set-url', 'origin', join(world.root, 'gone.git')])
  const stale = await core.refresh()
  const workRow = stale.rows.find((row) => row.name === 'dsh-plugin-work')
  assert.equal(workRow.stale, true)
  assert.equal(workRow.status, 'current')
})

test('two moves on one bundle queue instead of racing', async (t) => {
  const { world, core } = await setup(t)
  await core.load()

  await world.commit(world.laptop, 'a.txt', 'a\n', 'laptop one')
  await world.push(world.laptop)

  const [first, second] = await Promise.all([
    core.update('dsh-plugin-work'),
    core.update('dsh-plugin-work'),
  ])
  assert.equal(first.ok, true)
  assert.equal(second.ok, true)
  assert.equal(await world.head(world.work), await world.head(world.laptop))
})

test('unknown bundles produce a typed error', async (t) => {
  const { core } = await setup(t)
  await core.load()
  await assert.rejects(core.update('nope'), (error) => error.code === 'unknown-bundle')
  await assert.rejects(core.sync('nope'), (error) => error.code === 'unknown-bundle')
  await assert.rejects(core.switch('nope', 'main'), (error) => error.code === 'unknown-bundle')
  await assert.rejects(core.revert('nope'), (error) => error.code === 'unknown-bundle')
})
