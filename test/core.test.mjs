/**
 * The core: state hydration, check passes, queued moves, receipts and tracks.
 */

import assert from 'node:assert/strict'
import { readFile, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { createCore, OWN_PACKAGE } from '../lib/core.js'
import { makeWorld, run } from './fixtures.mjs'

/** Build a world, a state directory and a core that watches both clones. */
async function setup(t, options = {}) {
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
  const core = createCore({ bundleSource, env, argv: [], ...options })
  return { world, stateDirectory, core }
}

test('the core hydrates cached rows from the state file', async (t) => {
  const { world, core } = await setup(t)
  await core.load()
  assert.equal(core.snapshot().rows.length, 0)

  const checked = await core.refresh()
  assert.equal(checked.rows.length, 2)
  assert.equal(checked.dot, 'green')
  assert.match(checked.version ?? '', /^\d+\.\d+\.\d+/u)
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

test('settings save, validate and appear in the snapshot', async (t) => {
  const { world, core } = await setup(t)
  await core.load()

  const saved = await core.setSettings({ checkIntervalMinutes: 15, refreshOnStartup: false, versionWarnings: false })
  assert.equal(saved.settings.checkIntervalMinutes, 15)
  assert.equal(saved.settings.refreshOnStartup, false)
  assert.equal(saved.settings.versionWarnings, false)

  const customShelf = join(world.root, 'custom-shelf')
  const shelfSaved = await core.setSettings({ pluginsDir: customShelf })
  assert.equal(shelfSaved.settings.pluginsDir, customShelf)
  assert.equal(shelfSaved.shelfDirectory, customShelf)
  assert.equal(core.shelfDirectory, customShelf)

  await core.setSettings({ pluginsDir: '' })
  assert.equal(core.snapshot().settings.pluginsDir, '')
  assert.notEqual(core.shelfDirectory, customShelf)

  const owners = await core.setSettings({ catalogOwners: ['dsh-works', 'other-org'], defaultOwner: 'other-org' })
  assert.deepEqual(owners.settings.catalogOwners, ['dsh-works', 'other-org'])
  assert.equal(owners.settings.defaultOwner, 'other-org')
  await assert.rejects(core.setSettings({ catalogOwners: ['bad owner!'] }), (error) => error.code === 'invalid-settings')
  await assert.rejects(core.setSettings({ defaultOwner: 'not-configured' }), (error) => error.code === 'invalid-settings')

  assert.equal(core.snapshot().settings.terminal, 'auto')
  assert.ok(Array.isArray(core.snapshot().terminalChoices))
  assert.equal((await core.setSettings({ terminal: 'auto' })).settings.terminal, 'auto')
  await assert.rejects(core.setSettings({ terminal: 'not-a-terminal' }), (error) => error.code === 'invalid-settings')

  await core.setSettings({ refreshOnStartup: true })
  assert.equal(core.snapshot().settings.refreshOnStartup, true)
  assert.equal(core.snapshot().settings.checkIntervalMinutes, 15)

  await assert.rejects(core.setSettings({ checkIntervalMinutes: -1 }), (error) => error.code === 'invalid-settings')
  await assert.rejects(core.setSettings({ versionWarnings: 'yes' }), (error) => error.code === 'invalid-settings')
  await assert.rejects(core.setSettings({ pluginsDir: 'relative/shelf' }), (error) => error.code === 'invalid-settings')
  await assert.rejects(core.setSettings({ pluginsDir: 42 }), (error) => error.code === 'invalid-settings')
  await assert.rejects(core.setSettings(null), (error) => error.code === 'invalid-settings')
})

test('compatibility warns when a bundle rejects the running harness', async (t) => {
  const { world, core } = await setup(t, { dshVersion: '0.2.2-rc.1' })
  for (const dir of [world.laptop, world.work]) {
    await writeFile(join(dir, 'package.json'), JSON.stringify({
      name: 'dsh-plugin-test',
      version: '0.1.0',
      engines: { dsh: '^9.0.0' },
    }))
  }

  await core.load()
  const snapshot = await core.refresh()
  assert.equal(snapshot.compat.runningDsh, '0.2.2-rc.1')
  const mismatch = snapshot.compat.warnings.find((warning) => warning.kind === 'engine-mismatch')
  assert.ok(mismatch)
  assert.equal(mismatch.requires, '^9.0.0')
  assert.equal(mismatch.running, '0.2.2-rc.1')

  await core.setSettings({ versionWarnings: false })
  assert.deepEqual(core.snapshot().compat.warnings.filter((warning) => warning.kind === 'engine-mismatch'), [])
})

test('the brief returns status and clears the timeline', async (t) => {
  const { world, core } = await setup(t)
  await core.load()
  await world.commit(world.laptop, 'a.txt', 'a\n', 'laptop one')
  await world.push(world.laptop)
  await core.sync('dsh-plugin-work')

  const first = await core.brief()
  assert.equal(first.ok, true)
  assert.equal(first.rows.length, 2)
  assert.ok(first.events.some((event) => event.kind === 'sync'))

  const second = await core.brief()
  assert.deepEqual(second.events, [])
})

test('the timeline records a move and clears when read', async (t) => {
  const { world, core } = await setup(t)
  await core.load()

  await world.commit(world.laptop, 'a.txt', 'a\n', 'laptop one')
  await world.push(world.laptop)
  await core.sync('dsh-plugin-work')

  const feed = await core.timeline()
  assert.ok(feed.events.some((event) => event.kind === 'sync' && event.bundle === 'dsh-plugin-work'))

  const cleared = await core.timeline()
  assert.deepEqual(cleared.events, [])
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

test('sync over all bundles skips viburnum itself', async (t) => {
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

test('detail reads branches, the incoming side and the reload class', async (t) => {
  const { world, core } = await setup(t)
  await core.load()

  await world.commit(world.laptop, 'package.json', JSON.stringify({ name: 'dsh-plugin-laptop', version: '0.1.0' }), 'package')
  await world.commit(world.laptop, 'CHANGELOG.md', '# Changelog\n\n## 0.2.0\n\n- next\n', 'changelog')
  await world.commit(world.laptop, 'client.js', 'void 0\n', 'client change')
  await run(world.laptop, ['switch', '-c', 'dev'])
  await run(world.laptop, ['push', '-u', 'origin', 'dev'])
  await run(world.laptop, ['switch', 'main'])
  await world.commit(world.laptop, 'package.json', JSON.stringify({ name: 'dsh-plugin-laptop', version: '0.2.0' }), 'bump')
  await world.push(world.laptop)
  await world.fetch(world.work)

  const detail = await core.detail('dsh-plugin-work')
  assert.equal(detail.ok, true)
  assert.equal(detail.bundle.track, 'main')
  assert.ok(detail.branches.includes('main'))
  assert.ok(detail.branches.includes('dev'))
  assert.equal(detail.incoming.behind, 4)
  assert.equal(detail.incoming.targetVersion, '0.2.0')
  assert.equal(detail.incoming.currentVersion, null)
  assert.match(detail.incoming.changelog, /- next/u)
  assert.ok(detail.incoming.changed.includes('client.js'))
  assert.equal(detail.incoming.reload.browser, true)
  assert.equal(detail.incoming.reload.dependencies, true)
  assert.match(detail.incoming.reloadLabel, /refresh the page/u)

  await assert.rejects(core.detail('nope'), (error) => error.code === 'unknown-bundle')
})

test('documents are read from inside the bundle, capped and validated', async (t) => {
  const { world, core } = await setup(t)
  await core.load()

  const readme = await core.readDocument('dsh-plugin-work', 'readme')
  assert.equal(readme.ok, true)
  assert.equal(readme.target, 'readme')
  assert.match(readme.text, /# fixture/u)
  assert.equal(readme.truncated, false)
  assert.equal(readme.path, join(world.work, 'README.md'))

  const changelog = await core.readDocument('dsh-plugin-work', 'changelog')
  assert.equal(changelog.ok, false)
  assert.equal(changelog.code, 'missing-file')

  const folder = await core.readDocument('dsh-plugin-work', 'folder')
  assert.equal(folder.code, 'unknown-target')

  await assert.rejects(core.readDocument('nope', 'readme'), (error) => error.code === 'unknown-bundle')
})

test('open targets resolve only inside the bundle', async (t) => {
  const { world, core } = await setup(t)
  await core.load()

  const folder = await core.openTarget('dsh-plugin-work', 'folder')
  assert.equal(folder.ok, true)
  assert.equal(folder.path, world.work)

  const readme = await core.openTarget('dsh-plugin-work', 'readme')
  assert.equal(readme.ok, true)
  assert.ok(readme.path.endsWith('README.md'))

  const changelog = await core.openTarget('dsh-plugin-work', 'changelog')
  assert.equal(changelog.ok, false)
  assert.equal(changelog.code, 'missing-file')

  const unknown = await core.openTarget('dsh-plugin-work', 'nope')
  assert.equal(unknown.code, 'unknown-target')

  await assert.rejects(core.openTarget('nope', 'folder'), (error) => error.code === 'unknown-bundle')
})
