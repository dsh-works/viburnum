/**
 * The move policies, exercised against the offline two-clone world.
 */

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'

import { makeWorld, run } from './fixtures.mjs'
import {
  FAILURE,
  abortConflict,
  agreeConflict,
  continueConflict,
  isAppendOnly,
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

test('sync leaves a conflicting rebase stopped with three exits', async (t) => {
  const world = await makeWorld(t)
  const base = '# fixture\n\nline one\nline two\n'

  await world.commit(world.laptop, 'README.md', base.replace('line two', 'from laptop'), 'laptop edit')
  await world.push(world.laptop)
  await world.commit(world.work, 'README.md', base.replace('line two', 'from work'), 'work edit')

  const result = await syncBundle({ name: 'plugin-a', dir: world.work, track: 'main' })
  assert.equal(result.ok, false)
  assert.equal(result.code, FAILURE.conflict)
  assert.deepEqual(result.files, ['README.md'])
  assert.equal(result.bundle, 'plugin-a')
  assert.equal(result.exits.guide.available, true)
  assert.equal(result.exits.myself.available, true)
  assert.equal(result.exits.agree.available, false)
  assert.match(result.exits.agree.reason, /README\.md/u)
  assert.equal(await rebaseInProgress(world.work), true)

  const aborted = await abortConflict({ name: 'plugin-a', dir: world.work, track: 'main' })
  assert.equal(aborted.ok, true)
  assert.equal(aborted.receipt.result, 'aborted')
  assert.equal(await rebaseInProgress(world.work), false)
  assert.deepEqual(await counts(world.work, 'origin/main'), { behind: 1, ahead: 1 })
})

test('Agree refuses a conflict outside the append-only allowlist', async (t) => {
  const world = await makeWorld(t)
  const base = '# fixture\n\nline one\nline two\n'

  await world.commit(world.laptop, 'README.md', base.replace('line two', 'from laptop'), 'laptop edit')
  await world.push(world.laptop)
  await world.commit(world.work, 'README.md', base.replace('line two', 'from work'), 'work edit')

  await syncBundle({ name: 'plugin-a', dir: world.work, track: 'main' })
  const refused = await agreeConflict({ name: 'plugin-a', dir: world.work, track: 'main' })
  assert.equal(refused.ok, false)
  assert.equal(refused.code, FAILURE.agreeUnavailable)
  assert.match(refused.message, /README\.md/u)
  await abortConflict({ name: 'plugin-a', dir: world.work, track: 'main' })
})

test('Agree union-merges CHANGELOG conflicts, continues the rebase and pushes', async (t) => {
  const world = await makeWorld(t)
  const base = '# Changelog\n\n## 0.1.0\n\n- base change\n'

  await world.commit(world.laptop, 'CHANGELOG.md', base, 'base changelog')
  await world.push(world.laptop)
  await run(world.work, ['pull', '--ff-only'])

  await world.commit(world.laptop, 'CHANGELOG.md', base + '- laptop change\n', 'laptop changelog')
  await world.push(world.laptop)
  await world.commit(world.work, 'CHANGELOG.md', base + '- work change\n', 'work changelog')
  assert.equal(isAppendOnly('docs/CHANGELOG.md'), true)
  assert.equal(isAppendOnly('README.md'), false)

  const conflict = await syncBundle({ name: 'plugin-a', dir: world.work, track: 'main' })
  assert.equal(conflict.code, FAILURE.conflict)
  assert.equal(conflict.exits.agree.available, true)

  const agreed = await agreeConflict({ name: 'plugin-a', dir: world.work, track: 'main' })
  assert.equal(agreed.ok, true)
  assert.equal(agreed.receipt.kind, 'sync')
  assert.equal(await rebaseInProgress(world.work), false)
  assert.deepEqual(await counts(world.work, 'origin/main'), { behind: 0, ahead: 0 })

  const text = await readFile(join(world.work, 'CHANGELOG.md'), 'utf8')
  assert.match(text, /- laptop change/u)
  assert.match(text, /- work change/u)
  assert.equal(await run(world.origin, ['rev-parse', 'main']), await world.head(world.work))
})

test('Retry continues a rebase after a manual resolution', async (t) => {
  const world = await makeWorld(t)
  const base = '# fixture\n\nline one\nline two\n'

  await world.commit(world.laptop, 'README.md', base.replace('line two', 'from laptop'), 'laptop edit')
  await world.push(world.laptop)
  await world.commit(world.work, 'README.md', base.replace('line two', 'from work'), 'work edit')

  await syncBundle({ name: 'plugin-a', dir: world.work, track: 'main' })
  await world.write(world.work, 'README.md', '# fixture\n\nresolved by hand\n')
  await run(world.work, ['add', 'README.md'])

  const continued = await continueConflict({ name: 'plugin-a', dir: world.work, track: 'main' })
  assert.equal(continued.ok, true)
  assert.equal(await rebaseInProgress(world.work), false)
  assert.deepEqual(await counts(world.work, 'origin/main'), { behind: 0, ahead: 0 })
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
