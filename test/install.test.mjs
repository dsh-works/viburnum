/**
 * Install-door checks for the viburnum core.
 *
 * The plugin manager is stubbed: these tests own the validation, the shelf
 * layout and the refusals, not pnpm or git.
 */

import assert from 'node:assert/strict'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { createCore } from '../lib/core.js'

/** Write one checkout manifest at an exact directory. */
async function writeCheckout(dir, name, { bundle = true } = {}) {
  await mkdir(dir, { recursive: true })
  const pkg = { name, version: '0.1.0' }
  if (bundle) pkg.dsh = { bundle: { patch: './cordis.patch.yml' } }
  await writeFile(join(dir, 'package.json'), JSON.stringify(pkg, null, 2))
  if (bundle) await writeFile(join(dir, 'cordis.patch.yml'), '- insert: []\n')
  return dir
}

/** Create one core over a temporary home with stubbed plugin-manager halves. */
async function makeCore(t, overrides = {}) {
  const root = await mkdtemp(join(tmpdir(), 'viburnum-install-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const calls = { installed: [], inspected: [], cloned: [] }

  const core = createCore({
    bundleSource: async () => ({ profileDir: root, bundles: [] }),
    env: { DSH_HOME: root },
    installer: async (spec) => {
      calls.installed.push(spec)
      const pkg = JSON.parse(await readFile(join(spec, 'package.json'), 'utf8'))
      return { changed: true, application: 'applied', bundle: pkg.name, version: pkg.version }
    },
    inspector: async (spec) => {
      calls.inspected.push(spec)
      const pkg = JSON.parse(await readFile(join(spec, 'package.json'), 'utf8'))
      return { status: 'accepted', kind: 'path', name: pkg.name, version: pkg.version, bundle: true }
    },
    cloner: async (url, target) => {
      calls.cloned.push({ url, target })
      await writeCheckout(target, 'dsh-plugin-cloned')
    },
    ...overrides,
  })
  await core.load()
  return { root, core, calls }
}

test('the directory door links an existing checkout', async (t) => {
  const { root, core, calls } = await makeCore(t)
  const dir = await writeCheckout(join(root, 'checkouts', 'new-plugin'), 'dsh-plugin-new')

  const receipt = await core.installDirectory(dir)
  assert.equal(receipt.ok, true)
  assert.equal(receipt.installed, true)
  assert.equal(receipt.name, 'dsh-plugin-new')
  assert.equal(receipt.version, '0.1.0')
  assert.equal(receipt.path, dir)
  assert.equal(receipt.door, 'directory')
  assert.deepEqual(calls.installed, [dir])
  assert.deepEqual(calls.inspected, [dir])
})

test('the directory door refuses what it cannot adopt', async (t) => {
  const { root, core } = await makeCore(t)
  const relative = await core.installDirectory('checkouts/new-plugin')
  assert.equal(relative.code, 'invalid-directory')

  const missing = await core.installDirectory(join(root, 'checkouts', 'absent'))
  assert.equal(missing.code, 'missing-directory')

  const plain = await writeCheckout(join(root, 'checkouts', 'plain'), 'dsh-plugin-plain', { bundle: false })
  const notBundle = await core.installDirectory(plain)
  assert.equal(notBundle.code, 'not-a-bundle')
})

test('the directory door refuses an already-linked or refused checkout', async (t) => {
  const dir = await writeCheckout(join(tmpdir(), 'viburnum-already-'), 'dsh-plugin-new')
  t.after(() => rm(dir, { recursive: true, force: true }))

  const already = await makeCore(t, {
    bundleSource: async () => ({ profileDir: dir, bundles: [{ name: 'dsh-plugin-new', dir, spec: dir }] }),
  })
  assert.equal((await already.core.installDirectory(dir)).code, 'already-installed')

  const refused = await makeCore(t, {
    inspector: async () => ({ status: 'refused', problem: 'not-a-bundle', reason: 'no patch' }),
  })
  assert.equal((await refused.core.installDirectory(dir)).code, 'not-a-bundle')

  const unavailable = await makeCore(t, { installer: null })
  assert.equal((await unavailable.core.installDirectory(dir)).code, 'install-unavailable')
})

test('a failed plugin-manager install becomes a readable refusal', async (t) => {
  const { root, core } = await makeCore(t, {
    installer: async () => ({ changed: false, application: 'failed', error: { code: 'operation-error', diagnostic: 'pnpm said no' } }),
  })
  const dir = await writeCheckout(join(root, 'checkouts', 'new-plugin'), 'dsh-plugin-new')
  const receipt = await core.installDirectory(dir)
  assert.equal(receipt.ok, false)
  assert.equal(receipt.code, 'install-failed')
  assert.equal(receipt.message, 'pnpm said no')
})

test('the repository door clones into the shelf, then links the checkout', async (t) => {
  const { root, core, calls } = await makeCore(t)
  const receipt = await core.installRepository('dsh-works/dsh-plugin-cloned')

  assert.equal(receipt.ok, true)
  assert.equal(receipt.cloned, true)
  assert.equal(receipt.repository, 'https://github.com/dsh-works/dsh-plugin-cloned.git')
  assert.equal(receipt.name, 'dsh-plugin-cloned')
  const target = join(root, 'viburnum', 'plugins', 'dsh-plugin-cloned')
  assert.equal(receipt.path, target)
  assert.deepEqual(calls.cloned, [{ url: 'https://github.com/dsh-works/dsh-plugin-cloned.git', target }])
})

test('the repository door refuses bad input, collisions and missing clones', async (t) => {
  const { root, core } = await makeCore(t)
  assert.equal((await core.installRepository('not a repository')).code, 'invalid-repository')
  assert.equal((await core.installRepository('https://user:pass@github.com/o/r')).code, 'invalid-repository')

  const shelf = join(root, 'viburnum', 'plugins', 'dsh-plugin-cloned')
  await mkdir(shelf, { recursive: true })
  const collision = await core.installRepository('dsh-works/dsh-plugin-cloned')
  assert.equal(collision.code, 'shelf-collision')
  assert.equal(collision.path, shelf)

  const failing = await makeCore(t, { cloner: async () => { throw new Error('git exited 128') } })
  const clone = await failing.core.installRepository('dsh-works/dsh-plugin-cloned')
  assert.equal(clone.code, 'clone-failed')
  assert.equal(clone.message, 'git exited 128')

  const noCloner = await makeCore(t, { cloner: null })
  assert.equal((await noCloner.core.installRepository('dsh-works/x')).code, 'install-unavailable')
})

test('a configured pluginsDir replaces the default shelf', async (t) => {
  const custom = await mkdtemp(join(tmpdir(), 'viburnum-shelf-'))
  t.after(() => rm(custom, { recursive: true, force: true }))
  const { core } = await makeCore(t, { config: { pluginsDir: custom } })
  const receipt = await core.installRepository('dsh-works/dsh-plugin-cloned')
  assert.equal(receipt.ok, true)
  assert.equal(receipt.path, join(custom, 'dsh-plugin-cloned'))
  assert.equal(core.shelfDirectory, custom)
})

// The access import is used by the shelf-collision path through the core; keep
// this helper exercised so a broken import fails the suite early.
test('the test home is readable', async (t) => {
  const { root } = await makeCore(t)
  await access(root)
})
