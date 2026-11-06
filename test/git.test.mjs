/**
 * The git seam, exercised against real offline repositories.
 *
 * Every test builds its own bare origin and two clones; nothing here needs a
 * network, a profile, or a browser.
 */

import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'

import {
  abortRebase,
  counts,
  createTrackingBranch,
  diffNames,
  fastForward,
  fetch,
  git,
  inspect,
  localBranches,
  logSubjects,
  push,
  rebaseInProgress,
  rebaseOnto,
  remoteBranches,
  remoteRefsContaining,
  resetHard,
  revList,
  showFile,
  switchBranch,
  validBranchName,
  verifyRef,
} from '../lib/git.js'
import { makeWorld, run } from './fixtures.mjs'

test('inspect reports the checkout without network access', async (t) => {
  const world = await makeWorld(t)
  const clean = await inspect(world.laptop)

  assert.equal(clean.ok, true)
  assert.equal(clean.branch, 'main')
  assert.equal(clean.detached, false)
  assert.equal(clean.dirty, false)
  assert.equal(clean.dirtyCount, 0)
  assert.equal(clean.remote, world.origin)
  assert.equal(clean.head, await world.head(world.laptop))

  await world.write(world.laptop, 'DIRTY.md', 'x\n')
  const dirty = await inspect(world.laptop)
  assert.equal(dirty.dirty, true)
  assert.equal(dirty.dirtyCount, 1)

  await run(world.laptop, ['checkout', '--detach'])
  const detached = await inspect(world.laptop)
  assert.equal(detached.detached, true)

  const missing = await inspect(join(world.root, 'not-here'))
  assert.equal(missing.ok, false)
  assert.equal(missing.reason, 'missing')

  const plain = join(world.root, 'plain')
  await mkdir(plain)
  const notRepo = await inspect(plain)
  assert.equal(notRepo.ok, false)
  assert.equal(notRepo.reason, 'not-a-repo')
})

test('counts and commit lists point in the right direction', async (t) => {
  const world = await makeWorld(t)

  await world.commit(world.laptop, 'a.txt', 'a\n', 'laptop one')
  await world.push(world.laptop)
  await world.fetch(world.work)

  assert.deepEqual(await counts(world.work, 'origin/main'), { behind: 1, ahead: 0 })
  const incoming = await revList(world.work, 'HEAD..origin/main')
  assert.equal(incoming.length, 1)
  assert.equal(incoming[0], await world.head(world.laptop))

  await world.commit(world.work, 'b.txt', 'b\n', 'work one')
  assert.deepEqual(await counts(world.work, 'origin/main'), { behind: 1, ahead: 1 })

  const theirs = await revList(world.work, 'origin/main..HEAD')
  assert.equal(theirs.length, 1)
  assert.equal(theirs[0], await world.head(world.work))
})

test('fast-forward moves only when the upstream contains HEAD', async (t) => {
  const world = await makeWorld(t)

  await world.commit(world.laptop, 'a.txt', 'a\n', 'laptop one')
  await world.push(world.laptop)
  await world.fetch(world.work)

  const moved = await fastForward(world.work, 'origin/main')
  assert.equal(moved.ok, true)
  assert.equal(await world.head(world.work), await world.head(world.laptop))

  await world.commit(world.laptop, 'b.txt', 'b\n', 'laptop two')
  await world.push(world.laptop)
  await world.commit(world.work, 'c.txt', 'c\n', 'work one')
  await world.fetch(world.work)

  const refused = await fastForward(world.work, 'origin/main')
  assert.equal(refused.ok, false)
})

test('push publishes HEAD to the track without force', async (t) => {
  const world = await makeWorld(t)

  await world.commit(world.work, 'w.txt', 'w\n', 'work one')
  const published = await push(world.work, 'main')

  assert.equal(published.ok, true)
  assert.equal(await run(world.origin, ['rev-parse', 'main']), await world.head(world.work))
})

test('rebase replays private commits onto the track', async (t) => {
  const world = await makeWorld(t)

  await world.commit(world.laptop, 'l.txt', 'l\n', 'laptop one')
  await world.push(world.laptop)
  await world.commit(world.work, 'w.txt', 'w\n', 'work one')
  await world.fetch(world.work)

  const rebased = await rebaseOnto(world.work, 'origin/main')
  assert.equal(rebased.ok, true)
  assert.deepEqual(await counts(world.work, 'origin/main'), { behind: 0, ahead: 1 })

  const log = await logSubjects(world.work, 'origin/main..HEAD')
  assert.equal(log.length, 1)
  assert.equal(log[0].subject, 'work one')
  assert.equal(await rebaseInProgress(world.work), false)
})

test('a conflicting rebase reports the files and can be aborted', async (t) => {
  const world = await makeWorld(t)
  const base = '# fixture\n\nline one\nline two\n'

  await world.commit(world.laptop, 'README.md', base.replace('line two', 'from laptop'), 'laptop edit')
  await world.push(world.laptop)
  await world.commit(world.work, 'README.md', base.replace('line two', 'from work'), 'work edit')
  await world.fetch(world.work)

  const conflicted = await rebaseOnto(world.work, 'origin/main')
  assert.equal(conflicted.ok, false)
  assert.deepEqual(conflicted.files, ['README.md'])
  assert.equal(await rebaseInProgress(world.work), true)

  assert.equal(await abortRebase(world.work), true)
  assert.equal(await rebaseInProgress(world.work), false)
  assert.deepEqual(await counts(world.work, 'origin/main'), { behind: 1, ahead: 1 })
})

test('branches list, track creation and switching work offline', async (t) => {
  const world = await makeWorld(t)

  await run(world.laptop, ['switch', '-c', 'dev'])
  await run(world.laptop, ['push', '-u', 'origin', 'dev'])
  await world.fetch(world.work)

  assert.deepEqual(await remoteBranches(world.work), ['origin/dev', 'origin/main'])

  const created = await createTrackingBranch(world.work, 'dev')
  assert.equal(created.ok, true)
  assert.equal(await world.branch(world.work), 'dev')
  assert.deepEqual(await localBranches(world.work), ['dev', 'main'])

  const switched = await switchBranch(world.work, 'main')
  assert.equal(switched.ok, true)
  assert.equal(await world.branch(world.work), 'main')
})

test('a commit already on a remote branch is detected as published', async (t) => {
  const world = await makeWorld(t)

  await world.commit(world.laptop, 'pub.txt', 'pub\n', 'published')
  await world.push(world.laptop)
  const published = await world.head(world.laptop)

  await world.commit(world.work, 'priv.txt', 'priv\n', 'private')
  await world.fetch(world.work)

  assert.deepEqual(await remoteRefsContaining(world.work, published), ['origin/main'])
  assert.deepEqual(await remoteRefsContaining(world.work, await world.head(world.work)), [])
})

test('file reads, diff names, reset and ref lookup use the recorded revisions', async (t) => {
  const world = await makeWorld(t)

  await world.commit(world.laptop, 'CHANGELOG.md', '# Changelog\n\n## 0.1.0\n\n- first\n', 'changelog')
  await world.commit(world.laptop, 'new.txt', 'new\n', 'add a file')
  await world.push(world.laptop)
  await world.fetch(world.work)

  const changelog = await showFile(world.work, 'origin/main', 'CHANGELOG.md')
  assert.equal(changelog.ok, true)
  assert.match(changelog.text, /0\.1\.0/u)
  assert.equal((await showFile(world.work, 'origin/main', 'missing.md')).ok, false)

  const subjects = await logSubjects(world.work, 'origin/main~1..origin/main')
  assert.equal(subjects.length, 1)
  assert.equal(subjects[0].subject, 'add a file')

  const changed = await diffNames(world.work, 'origin/main~2', 'origin/main')
  assert.deepEqual(changed, ['CHANGELOG.md', 'new.txt'])

  const track = await verifyRef(world.work, 'origin/main')
  assert.equal(track, await world.head(world.laptop))
  assert.equal(await verifyRef(world.work, 'origin/nope'), null)

  const restored = await resetHard(world.work, track)
  assert.equal(restored.ok, true)
  assert.equal(await world.head(world.work), track)
})

test('fetch settles with a result and branch names are validated', async (t) => {
  const world = await makeWorld(t)

  const fetched = await fetch(world.work)
  assert.equal(fetched.code, 0)

  assert.equal(await validBranchName(world.work, 'main'), true)
  assert.equal(await validBranchName(world.work, 'bad name'), false)

  const nonzero = await git(world.work, ['rev-parse', '--verify', 'no-such-ref'])
  assert.notEqual(nonzero.code, 0)
  assert.ok(nonzero.stderr.length > 0)

  await assert.rejects(
    git(join(world.root, 'not-here'), ['status']),
    (error) => error.code === 'ENOENT',
  )
})
