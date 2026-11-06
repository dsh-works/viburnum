/**
 * Package metadata checks for the viburnum bundle.
 *
 * These run under plain Node with no harness and no browser, as part of the
 * plugin repository's `check` script.
 */

import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { test } from 'node:test'

const root = new URL('../', import.meta.url)

/** Read and parse a JSON file relative to the package root. */
async function readJson(relative) {
  return JSON.parse(await readFile(new URL(relative, root), 'utf8'))
}

/** Read a text file relative to the package root. */
async function readText(relative) {
  return readFile(new URL(relative, root), 'utf8')
}

/** Flattened JSON key paths, for locale parity. */
function keyPaths(value, prefix = '') {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return [prefix]
  return Object.keys(value)
    .flatMap((key) => keyPaths(value[key], prefix === '' ? key : `${prefix}.${key}`))
    .sort()
}

test('every exported and published file exists', async () => {
  const pkg = await readJson('package.json')

  for (const target of Object.values(pkg.exports)) {
    if (typeof target !== 'string' || target.includes('*')) continue
    assert.ok(existsSync(new URL(target, root)), `${target} is exported but missing`)
  }

  for (const entry of pkg.files) {
    assert.ok(existsSync(new URL(entry, root)), `${entry} is in files but missing`)
  }
})

test('the bundle is declared with its patch and a valid harness range', async () => {
  const pkg = await readJson('package.json')

  assert.equal(pkg.type, 'module')
  assert.equal(pkg.private, true)
  assert.ok(pkg.engines?.dsh, 'engines.dsh must pin the tested harness range')
  assert.equal(pkg.dsh?.bundle?.patch, './cordis.patch.yml')

  if (pkg.dsh?.client) {
    assert.equal(pkg.dsh.client.platform, 'web')
    assert.ok(pkg.exports['./client'], 'dsh.client requires the ./client export')
  }
})

test('the host entry exports the function-plugin form', async () => {
  const entry = await import(new URL('index.js', root))

  assert.equal(entry.name, 'viburnum')
  assert.ok(Array.isArray(entry.inject))
  assert.equal(typeof entry.apply, 'function')
  assert.equal(entry.default, undefined, 'function plugin must not also export a default')
})

test('the browser half parses as a classic script', async () => {
  const pkg = await readJson('package.json')
  assert.equal(pkg.dsh?.client?.platform, 'web')
  assert.equal(pkg.exports['./client'], './client.js')

  const source = await readText('client.js')
  assert.ok(!/^\s*(?:import|export)\s/mu.test(source), 'client.js must not use ESM syntax')
  assert.ok(source.includes('__ModuleLoader__'), 'client.js must register through the module loader')
  assert.doesNotThrow(() => new Function(source), 'client.js must parse') // eslint-disable-line no-new, no-new-func
})

test('the patch row mounts this package under the row id', async () => {
  const pkg = await readJson('package.json')
  const patch = await readText('cordis.patch.yml')

  assert.match(patch, /^-\s*insert:/mu)
  assert.match(patch, /id:\s*viburnum\b/u)
  assert.ok(patch.includes(`name: '${pkg.name}'`), 'patch row names the package')
})

test('locale files carry the display metadata', async () => {
  const files = (await readdir(new URL('locale/', root))).filter((name) => name.endsWith('.json'))

  assert.ok(files.includes('en.json'), 'locale/en.json is required')

  for (const file of files) {
    const meta = (await readJson(`locale/${file}`)).meta

    assert.ok(typeof meta?.title === 'string' && meta.title.length > 0, `${file} title`)
    assert.ok(typeof meta?.description === 'string' && meta.description.length > 0, `${file} description`)
  }
})
