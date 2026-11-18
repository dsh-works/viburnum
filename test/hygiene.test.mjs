/**
 * Hygiene scan checks against real git fixtures: duplicates, unmerged
 * branches, dirty trees, and the promise that nothing is moved or deleted.
 */

import assert from 'node:assert/strict'
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { scanHygiene } from '../lib/hygiene.js'
import { run } from './fixtures.mjs'

/** Create one git checkout whose manifest names `name`. */
async function makeCheckout(dir, name) {
  await mkdir(dir, { recursive: true })
  await run(dir, ['init', '-b', 'main'])
  await writeFile(join(dir, 'package.json'), JSON.stringify({ name, version: '0.1.0' }, null, 2))
  await writeFile(join(dir, 'README.md'), `# ${name}\n`)
  await run(dir, ['add', '-A'])
  await run(dir, ['commit', '-m', 'init'])
  return dir
}

test('the scan reports duplicates, unmerged branches and dirty trees', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'viburnum-hygiene-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const workspace = join(root, 'ws')
  await mkdir(workspace, { recursive: true })

  const first = await makeCheckout(join(workspace, 'checkout-a'), 'dsh-plugin-same')
  const second = await makeCheckout(join(workspace, 'checkout-b'), 'dsh-plugin-same')

  await run(first, ['checkout', '-b', 'feature/unmerged'])
  await writeFile(join(first, 'feature.txt'), 'work\n')
  await run(first, ['add', '-A'])
  await run(first, ['commit', '-m', 'unmerged work'])

  await writeFile(join(second, 'untracked.txt'), 'not committed\n')

  const result = await scanHygiene({ roots: [workspace] })
  assert.equal(result.ok, true)
  assert.deepEqual(result.roots, [workspace])
  assert.equal(result.checkouts.length, 2)

  const duplicate = result.findings.find((finding) => finding.kind === 'duplicate-checkout')
  assert.equal(duplicate.name, 'dsh-plugin-same')
  assert.deepEqual([...duplicate.dirs].sort(), [first, second].sort())

  const unmerged = result.findings.find((finding) => finding.kind === 'unmerged-branch')
  assert.equal(unmerged.dir, first)
  assert.deepEqual(unmerged.branches, ['feature/unmerged'])

  const dirty = result.findings.find((finding) => finding.kind === 'dirty-checkout')
  assert.equal(dirty.dir, second)

  // The scan never removes or moves anything.
  await access(first)
  await access(second)
})

test('a clean workspace has no findings', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'viburnum-hygiene-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const workspace = join(root, 'ws')
  await makeCheckout(join(workspace, 'only'), 'dsh-plugin-only')

  const result = await scanHygiene({ roots: [workspace] })
  assert.equal(result.ok, true)
  assert.equal(result.checkouts.length, 1)
  assert.deepEqual(result.findings, [])
})

test('an off-track checkout is reported with its track', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'viburnum-hygiene-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const workspace = join(root, 'ws')
  const checkout = await makeCheckout(join(workspace, 'on-dev'), 'dsh-plugin-drifted')
  await run(checkout, ['checkout', '-b', 'dev'])

  const result = await scanHygiene({ roots: [workspace], tracks: { [checkout]: 'main' } })
  const finding = result.findings.find((entry) => entry.kind === 'off-track')
  assert.equal(finding.dir, checkout)
  assert.equal(finding.branch, 'dev')
  assert.equal(finding.track, 'main')
  assert.match(finding.suggestion, /switch the checkout to main/u)
  assert.equal(result.checkouts[0].track, 'main')

  const onTrack = await scanHygiene({ roots: [workspace], tracks: { [checkout]: 'dev' } })
  assert.deepEqual(onTrack.findings, [], 'a checkout on its track is not a finding')
})

test('missing roots are skipped', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'viburnum-hygiene-'))
  t.after(() => rm(root, { recursive: true, force: true }))

  const result = await scanHygiene({ roots: [join(root, 'absent')] })
  assert.equal(result.ok, true)
  assert.deepEqual(result.roots, [])
  assert.deepEqual(result.checkouts, [])
  assert.deepEqual(result.findings, [])
})
