/**
 * The check pass: classification, direction counts, stale rows and the dot.
 */

import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'

import {
  aggregateDot,
  checkAll,
  checkBundle,
  dotFor,
  STATUS,
  trackChoices,
} from '../lib/status.js'
import { makeWorld, run } from './fixtures.mjs'

test('a clean checkout on its track is current', async (t) => {
  const world = await makeWorld(t)
  await world.commit(world.laptop, 'package.json', JSON.stringify({ name: 'dsh-plugin-laptop', version: '0.1.0' }), 'package')
  await world.push(world.laptop)
  const row = await checkBundle({ name: 'plugin-a', dir: world.laptop })

  assert.equal(row.status, STATUS.current)
  assert.equal(row.dot, 'green')
  assert.equal(row.version, '0.1.0')
  assert.equal(row.ahead, 0)
  assert.equal(row.behind, 0)
  assert.equal(row.track, 'main')
  assert.equal(row.stale, false)
})

test('direction states are classified from the counts', async (t) => {
  const world = await makeWorld(t)

  await world.commit(world.laptop, 'a.txt', 'a\n', 'laptop one')
  await world.push(world.laptop)
  const behind = await checkBundle({ name: 'plugin-a', dir: world.work })
  assert.equal(behind.status, STATUS.remoteAhead)
  assert.equal(behind.dot, 'violet')
  assert.equal(behind.behind, 1)
  assert.equal(behind.theirs.length, 1)

  await world.commit(world.work, 'b.txt', 'b\n', 'work one')
  const diverged = await checkBundle({ name: 'plugin-a', dir: world.work })
  assert.equal(diverged.status, STATUS.diverged)
  assert.equal(diverged.dot, 'red')
  assert.equal(diverged.ahead, 1)
  assert.equal(diverged.behind, 1)
  assert.equal(diverged.yours.length, 1)
  assert.equal(diverged.theirs.length, 1)
})

test('dirty, detached, local-only, missing and unknown are reported', async (t) => {
  const world = await makeWorld(t)

  await world.write(world.work, 'dirty.txt', 'x\n')
  const dirty = await checkBundle({ name: 'plugin-a', dir: world.work })
  assert.equal(dirty.status, STATUS.dirty)
  assert.equal(dirty.dot, 'orange')
  assert.equal(dirty.dirtyCount, 1)

  await run(world.work, ['checkout', '--', '.'])
  await run(world.work, ['clean', '-fd'])
  await run(world.work, ['checkout', '--detach'])
  const detached = await checkBundle({ name: 'plugin-a', dir: world.work })
  assert.equal(detached.status, STATUS.detached)
  assert.equal(detached.dot, 'grey')

  const localDir = join(world.root, 'local-only')
  await run(world.root, ['init', '--initial-branch=main', localDir])
  await world.write(world.root, 'local-only/file.txt', 'x\n')
  await run(localDir, ['add', '--', 'file.txt'])
  await run(localDir, ['commit', '-m', 'local only'])
  const localOnly = await checkBundle({ name: 'plugin-local', dir: localDir })
  assert.equal(localOnly.status, STATUS.localOnly)
  assert.equal(localOnly.dot, 'grey')

  const missing = await checkBundle({ name: 'plugin-missing', dir: join(world.root, 'not-here') })
  assert.equal(missing.status, STATUS.missing)

  const plain = join(world.root, 'plain')
  await mkdir(plain)
  const unknown = await checkBundle({ name: 'plugin-plain', dir: plain })
  assert.equal(unknown.status, STATUS.unknown)
})

test('a rebase in progress is reported before a dirty tree', async (t) => {
  const world = await makeWorld(t)
  const base = '# fixture\n\nline one\nline two\n'

  await world.commit(world.laptop, 'README.md', base.replace('line two', 'from laptop'), 'laptop edit')
  await world.push(world.laptop)
  await world.commit(world.work, 'README.md', base.replace('line two', 'from work'), 'work edit')
  await world.fetch(world.work)
  try {
    await run(world.work, ['rebase', 'origin/main'])
  } catch {
    // The rebase is expected to conflict; the test asserts the checked state.
  }

  const row = await checkBundle({ name: 'plugin-a', dir: world.work })
  assert.equal(row.status, STATUS.rebasing)
  assert.equal(row.dot, 'grey')
})

test('a failed fetch keeps the previous row marked stale', async (t) => {
  const world = await makeWorld(t)
  const clean = await checkBundle({ name: 'plugin-a', dir: world.work })
  assert.equal(clean.status, STATUS.current)

  await run(world.work, ['remote', 'set-url', 'origin', join(world.root, 'gone.git')])
  const stale = await checkBundle({ name: 'plugin-a', dir: world.work, previous: clean })

  assert.equal(stale.status, STATUS.current)
  assert.equal(stale.stale, true)
  assert.ok(stale.staleError.length > 0)
})

test('the dot aggregates the worst state across rows', () => {
  assert.equal(aggregateDot([]), 'green')
  assert.equal(aggregateDot([{ dot: 'green' }, { dot: 'violet' }]), 'violet')
  assert.equal(aggregateDot([{ dot: 'violet' }, { dot: 'orange' }]), 'orange')
  assert.equal(aggregateDot([{ dot: 'orange' }, { dot: 'red' }]), 'red')
  assert.equal(aggregateDot([{ dot: 'red' }, { dot: 'grey' }]), 'red')
  assert.equal(aggregateDot([{ dot: 'grey' }, { dot: 'violet' }]), 'violet')

  assert.equal(dotFor(STATUS.current), 'green')
  assert.equal(dotFor(STATUS.remoteAhead), 'violet')
  assert.equal(dotFor(STATUS.dirty), 'orange')
  assert.equal(dotFor(STATUS.localAhead), 'red')
  assert.equal(dotFor('something-else'), 'grey')
})

test('a check pass checks every bundle within the bound', async (t) => {
  const world = await makeWorld(t)
  const rows = await checkAll([
    { name: 'laptop', dir: world.laptop },
    { name: 'work', dir: world.work },
  ])

  assert.equal(rows.length, 2)
  assert.deepEqual(rows.map((row) => row.status), [STATUS.current, STATUS.current])
  assert.equal(aggregateDot(rows), 'green')
})

test('track choices list remote branches without the symbolic HEAD', async (t) => {
  const world = await makeWorld(t)
  await run(world.laptop, ['switch', '-c', 'dev'])
  await run(world.laptop, ['push', '-u', 'origin', 'dev'])
  await world.fetch(world.work)

  assert.deepEqual(await trackChoices(world.work), ['dev', 'main'])
})
