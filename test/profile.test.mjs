/**
 * Profile discovery: names, directories, install specs and the two bundle
 * sources (the Host plugin manager and the profile's own package.json).
 */

import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, normalize, resolve } from 'node:path'
import { test } from 'node:test'

import {
  dshHome,
  listMountedBundles,
  parseInstallSpec,
  profileName,
  readProfileBundles,
  resolvedProfileDir,
} from '../lib/profile.js'

test('profile names follow explicit values, the environment and argv', () => {
  assert.equal(profileName({ env: {}, argv: [] }), 'web')
  assert.equal(profileName({ env: { DSH_PROFILE: 'work' }, argv: [] }), 'work')
  assert.equal(profileName({ explicit: 'other', env: { DSH_PROFILE: 'work' }, argv: [] }), 'other')
  assert.equal(profileName({ env: {}, argv: ['--profile', 'dev'] }), 'dev')
  assert.equal(profileName({ env: {}, argv: ['node', 'script', '--profile=alpha'] }), 'alpha')
  assert.equal(profileName({ env: {}, argv: ['--profile'] }), 'web')
})

test('the home and profile directories come from the environment', () => {
  assert.equal(dshHome({ DSH_HOME: 'C:/dsh' }), 'C:/dsh')
  assert.equal(dshHome({}), join(process.env.USERPROFILE ?? process.env.HOME ?? '', '.dsh').replace(/^$/, '.dsh'))
  assert.equal(
    resolvedProfileDir({ env: { DSH_PROFILE_DIR: 'C:/profiles/web' }, argv: [] }),
    resolve('C:/profiles/web'),
  )
  assert.equal(
    resolvedProfileDir({ env: { DSH_HOME: 'C:/dsh', DSH_PROFILE: 'work' }, argv: [] }),
    resolve('C:/dsh/profiles/work'),
  )
})

test('install specs resolve to checkout directories and non-local specs are ignored', () => {
  const base = resolve('C:/Users/example/.dsh/profiles/web')

  assert.equal(parseInstallSpec('link:C:/repos/plugin', base), normalize('C:/repos/plugin'))
  assert.equal(parseInstallSpec('link:../plugin', base), resolve(base, '../plugin'))
  assert.equal(parseInstallSpec('file:./local/plugin', base), resolve(base, 'local/plugin'))
  assert.equal(parseInstallSpec('  link:C:/repos/plugin  ', base), normalize('C:/repos/plugin'))

  for (const spec of ['', '   ', '1.2.3', 'github:dsh-works/plugin', 'C:/repos/plugin', null, undefined]) {
    assert.equal(parseInstallSpec(spec, base), null, String(spec))
  }
})

test('the profile package.json names its mounted linked bundles', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'viburnum-profile-'))
  t.after(() => rm(root, { recursive: true, force: true }))

  const profileDir = join(root, 'profiles', 'web')
  await mkdir(profileDir, { recursive: true })
  await writeFile(join(profileDir, 'package.json'), JSON.stringify({
    dependencies: {
      'dsh-plugin-a': 'link:C:/repos/a',
      'dsh-plugin-b': '1.0.0',
      'dsh-plugin-c': 'link:../c',
      'dsh-plugin-d': 'link:C:/repos/d',
    },
    dsh: { profile: { bundles: ['dsh-plugin-a', 'dsh-plugin-b', 'dsh-plugin-c'] } },
  }))

  const result = await readProfileBundles({
    env: { DSH_HOME: root, DSH_PROFILE: 'web' },
    argv: [],
  })

  assert.deepEqual(result.bundles.map((bundle) => bundle.name), ['dsh-plugin-a', 'dsh-plugin-c'])
  assert.equal(result.bundles[0].dir, normalize('C:/repos/a'))
  assert.equal(result.bundles[1].dir, resolve(profileDir, '../c'))
})

test('the Host plugin manager list is filtered to installed local bundles', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'viburnum-profile-'))
  t.after(() => rm(root, { recursive: true, force: true }))

  const pluginManager = {
    async listBundles() {
      return [
        { name: 'dsh-plugin-a', installed: true, enabled: true, version: '1.0.0', source: 'link:C:/repos/a' },
        { name: 'dsh-plugin-registry', installed: true, enabled: true, version: '2.0.0', source: '1.2.3' },
        { name: 'dsh-plugin-dup', installed: true, enabled: true, version: '0.1.0', source: 'link:C:/repos/dup-one' },
        { name: 'dsh-plugin-dup', installed: true, enabled: true, version: '0.2.0', source: 'link:C:/repos/dup-two' },
        { name: 'dsh-plugin-off', installed: false, enabled: false, source: 'link:C:/repos/off' },
        { name: 'dsh-plugin-nosource', installed: true, enabled: true },
        null,
      ]
    },
  }

  const result = await listMountedBundles(pluginManager, {
    env: { DSH_HOME: root, DSH_PROFILE: 'web' },
    argv: [],
  })

  assert.deepEqual(result.bundles.map((bundle) => bundle.name), ['dsh-plugin-a', 'dsh-plugin-dup'])
  assert.equal(result.bundles[0].dir, normalize('C:/repos/a'))
  assert.equal(result.bundles[0].version, '1.0.0')
  assert.equal(result.bundles[1].spec, 'link:C:/repos/dup-one', 'first record wins')
})
