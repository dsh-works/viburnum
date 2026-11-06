/**
 * The move policies, exercised against the offline two-clone world.
 */

import assert from 'node:assert/strict'
import { join } from 'node:path'
import { test } from 'node:test'

import { makeWorld, run } from './fixtures.mjs'
import {
  FAILURE,
  revertBundle,
  syncAll,
  syncBundle,
  switchBundle,
  updateBundle,
} from '../lib/sync.js'
import { counts, rebaseInProgress } from '../lib/git.js'

/** The initial commit of a fresh world. */
async function initialHead(world) {
  return world.head(world.work)
}

test('update fast-forwards, records a receipt and can be reverted', async (t) => {
  const world = await makeWorld(t)
  const before = await initialHead(world)

  await world.commit(world.laptop, 'a.txt', 'a\n', 'laptop one')
  await world.push(world.laptop)

  const updated = await updateBundle({ name: 'plugin-a', dir: world.work, track: 'main' })
  assert.equal(updated.ok, true)
  assert.equal(updated.receipt.kind, 'update')
  assert.equal(updated.receipt.pulled, 1)
  assert.equal(updated.receipt.from, before)
  assert.equal(updated.receipt.to, await world.head(world.laptop))
  assert.equal(updated.snapshot.head, before)

  const reverted = await revertBundle({ name: 'plugin-a', dir: world.work }, updated.snapshot)
  assert.equal(reverted.ok, true)
  assert.equal(reverted.receipt.kind, 'revert')
  assert.equal(await world.head(world.work), before)
  assert.equal(await world.branch(world.work), 'main')
})

test('update refuses dirty, detached, non-ff, local-only and off-track checkouts', async (t) => {
  const world = await makeWorld(t)

  await world.write(world.work, 'dirty.txt', 'x\n')
  assert.equal((await updateBundle({ name: 'plugin-a', dir: world.work, track: 'main' })).code, FAILURE.dirty)
  await run(world.work, ['clean', '-fd'])

  await run(world.work, ['checkout', '--detach'])
  assert.equal((await updateBundle({ name: 'plugin-a', dir: world.work, track: 'main' })).code, FAILURE.detached)
  await run(world.work, ['switch', 'main'])

  assert.equal(
    (await updateBundle({ name: 'plugin-a', dir: world.work, track: 'dev' })).code,
    FAILURE.notOnTrack,
  )

  const localDir = join(world.root, 'local-only')
  await run(world.root, ['init', '--initial-branch=main', localDir])
  await world.write(world.root, 'local-only/f.txt', 'x\n')
  await run(localDir, ['add', '--', 'f.txt'])
  await run(localDir, ['commit', '-m', 'local'])
  assert.equal(
    (await updateBundle({ name: 'plugin-local', dir: localDir, track: 'main' })).code,
    FAILURE.localOnly,
  )

  await world.commit(world.laptop, 'l.txt', 'l\n', 'laptop')
  await world.push(world.laptop)
  await world.commit(world.work, 'w.txt', 'w\n', 'work')
  const diverged = await updateBundle({ name: 'plugin-a', dir: world.work, track: 'main' })
  assert.equal(diverged.code, FAILURE.notFastForward)
})

test('sync pushes, pulls and reports nothing when already current', async (t) => {
  const world = await makeWorld(t)

  await world.commit(world.work, 'w.txt', 'w\n', 'work one')
  const pushed = await syncBundle({ name: 'plugin-a', dir: world.work, track: 'main' })
  assert.equal(pushed.ok, true)
  assert.equal(pushed.receipt.pushed, 1)
  assert.equal(await run(world.origin, ['rev-parse', 'main']), await world.head(world.work))

  const nothing = await syncBundle({ name: 'plugin-a', dir: world.work, track: 'main' })
  assert.equal(nothing.ok, true)
  assert.equal(nothing.nothing, true)
  assert.equal(nothing.receipt.result, 'nothing')

  await world.pull(world.laptop)
  await world.commit(world.laptop, 'l.txt', 'l\n', 'laptop one')
  await world.push(world.laptop)
  const pulled = await syncBundle({ name: 'plugin-a', dir: world.work, track: 'main' })
  assert.equal(pulled.ok, true)
  assert.equal(pulled.receipt.pulled, 1)
  assert.equal(await world.head(world.work), await world.head(world.laptop))
})

test('sync rebases private divergence and pushes it', async (t) => {
  const world = await makeWorld(t)

  await world.commit(world.laptop, 'l.txt', 'l\n', 'laptop one')
  await world.push(world.laptop)
  await world.commit(world.work, 'w.txt', 'w\n', 'work one')
  const workBefore = await world.head(world.work)

  const result = await syncBundle({ name: 'plugin-a', dir: world.work, track: 'main' })
  assert.equal(result.ok, true)
  assert.equal(result.receipt.rebased, 1)
  assert.equal(result.receipt.pushed, 1)
  assert.equal(result.receipt.pulled, 1)
  assert.notEqual(result.receipt.to, workBefore)
  assert.deepEqual(await counts(world.work, 'origin/main'), { behind: 0, ahead: 0 })
  assert.equal(await run(world.origin, ['rev-parse', 'main']), result.receipt.to)
})

test('sync refuses divergence whose local commits are already published', async (t) => {
  const world = await makeWorld(t)

  await world.commit(world.work, 'private.txt', 'p\n', 'private work')
  await run(world.work, ['push', 'origin', 'HEAD:dev'])
  const privateHead = await world.head(world.work)

  await world.commit(world.laptop, 'l.txt', 'l\n', 'laptop one')
  await world.push(world.laptop)

  const result = await syncBundle({ name: 'plugin-a', dir: world.work, track: 'main' })
  assert.equal(result.ok, false)
  assert.equal(result.code, FAILURE.published)
  assert.ok(result.published.some((entry) => entry.sha === privateHead))
  assert.ok(result.published.some((entry) => entry.refs.includes('origin/dev')))
  assert.equal(result.yours.length, 1)
  assert.equal(result.theirs.length, 1)
})

test('sync aborts a conflicting rebase before reporting it', async (t) => {
  const world = await makeWorld(t)
  const base = '# fixture\n\nline one\nline two\n'

  await world.commit(world.laptop, 'README.md', base.replace('line two', 'from laptop'), 'laptop edit')
  await world.push(world.laptop)
  await world.commit(world.work, 'README.md', base.replace('line two', 'from work'), 'work edit')

  const result = await syncBundle({ name: 'plugin-a', dir: world.work, track: 'main' })
  assert.equal(result.ok, false)
  assert.equal(result.code, FAILURE.conflict)
  assert.deepEqual(result.files, ['README.md'])
  assert.equal(result.aborted, true)
  assert.equal(await rebaseInProgress(world.work), false)
  assert.deepEqual(await counts(world.work, 'origin/main'), { behind: 1, ahead: 1 })
})

test('sync gates dirty trees before touching anything', async (t) => {
  const world = await makeWorld(t)
  await world.write(world.work, 'dirty.txt', 'x\n')

  const result = await syncBundle({ name: 'plugin-a', dir: world.work, track: 'main' })
  assert.equal(result.ok, false)
  assert.equal(result.code, FAILURE.dirty)
  assert.equal(result.hint, 'git stash')
})

test('a dry run reports the plan without moving anything', async (t) => {
  const world = await makeWorld(t)

  await world.commit(world.laptop, 'l.txt', 'l\n', 'laptop one')
  await world.push(world.laptop)
  await world.fetch(world.work)
  const before = await world.head(world.work)

  const plan = await syncBundle({ name: 'plugin-a', dir: world.work, track: 'main' }, { dryRun: true })
  assert.equal(plan.ok, true)
  assert.equal(plan.dryRun, true)
  assert.equal(plan.plan.action, 'pull')
  assert.equal(plan.plan.pulled, 1)
  assert.equal(await world.head(world.work), before)

  await world.commit(world.work, 'w.txt', 'w\n', 'work one')
  await world.fetch(world.work)
  const rebasePlan = await syncBundle({ name: 'plugin-a', dir: world.work, track: 'main' }, { dryRun: true })
  assert.equal(rebasePlan.plan.action, 'rebase')
  assert.equal(rebasePlan.plan.rebased, 1)
  assert.equal(rebasePlan.plan.pulled, 1)
})

test('switch creates a tracking branch and reports the reload class', async (t) => {
  const world = await makeWorld(t)

  await run(world.laptop, ['switch', '-c', 'dev'])
  await world.commit(world.laptop, 'client.js', 'void 0\n', 'dev browser change')
  await run(world.laptop, ['push', '-u', 'origin', 'dev'])

  const switched = await switchBundle({ name: 'plugin-a', dir: world.work }, 'dev')
  assert.equal(switched.ok, true)
  assert.equal(await world.branch(world.work), 'dev')
  assert.equal(switched.receipt.kind, 'switch')
  assert.equal(switched.receipt.track, 'dev')
  assert.equal(switched.receipt.fromTrack, 'main')
  assert.deepEqual(switched.reload, { browser: true, host: false, dependencies: false })

  const back = await switchBundle({ name: 'plugin-a', dir: world.work }, 'main')
  assert.equal(back.ok, true)
  assert.equal(await world.branch(world.work), 'main')
})

test('switch refuses unknown and invalid tracks and dirty trees', async (t) => {
  const world = await makeWorld(t)

  assert.equal((await switchBundle({ name: 'plugin-a', dir: world.work }, 'nope')).code, FAILURE.unknownTrack)
  assert.equal((await switchBundle({ name: 'plugin-a', dir: world.work }, 'bad name')).code, FAILURE.invalidTrack)

  await world.write(world.work, 'dirty.txt', 'x\n')
  assert.equal((await switchBundle({ name: 'plugin-a', dir: world.work }, 'main')).code, FAILURE.dirty)
})

test('sync all keeps going after a blocked row and totals the receipts', async (t) => {
  const world = await makeWorld(t)

  await world.commit(world.laptop, 'l.txt', 'l\n', 'laptop one')
  await world.push(world.laptop)
  await world.write(world.laptop, 'dirty.txt', 'x\n')

  const outcome = await syncAll([
    { name: 'laptop', dir: world.laptop, track: 'main' },
    { name: 'work', dir: world.work, track: 'main' },
  ])

  assert.equal(outcome.results.length, 2)
  assert.equal(outcome.results[0].ok, false)
  assert.equal(outcome.results[0].code, FAILURE.dirty)
  assert.equal(outcome.results[1].ok, true)
  assert.equal(outcome.results[1].receipt.pulled, 1)
  assert.deepEqual(outcome.totals, { pushed: 0, pulled: 1, rebased: 0 })
  assert.equal(outcome.ok, false)
})
