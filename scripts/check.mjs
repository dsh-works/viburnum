/**
 * Static bundle checks that need neither the harness nor a browser.
 *
 * `npm run check` runs this before the test suite: it validates the manifest,
 * the patch row, the locale files and the published file list, so a broken
 * package fails fast without spawning anything.
 */

import { existsSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'

const root = new URL('../', import.meta.url)
const problems = []

/** Record one failed expectation. */
function expect(condition, message) {
  if (!condition) problems.push(message)
}

/** Flattened JSON key paths, for locale parity. */
function keyPaths(value, prefix = '') {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return [prefix]
  return Object.keys(value)
    .flatMap((key) => keyPaths(value[key], prefix === '' ? key : `${prefix}.${key}`))
    .sort()
}

/** Read one JSON file relative to the package root. */
async function readJson(relative) {
  return JSON.parse(await readFile(new URL(relative, root), 'utf8'))
}

const pkg = await readJson('package.json')

expect(pkg.name === 'dsh-plugin-viburnum', 'name is dsh-plugin-viburnum')
expect(pkg.private === true, 'package is private')
expect(pkg.type === 'module', 'type is module')
expect(pkg.main === 'index.js', 'main is index.js')
expect(typeof pkg.engines?.dsh === 'string' && pkg.engines.dsh.length > 0, 'engines.dsh pins a range')
expect(pkg.engines?.node === '>=22', 'engines.node is >=22')
expect(pkg.dsh?.bundle?.patch === './cordis.patch.yml', 'dsh.bundle.patch is ./cordis.patch.yml')

for (const [key, target] of Object.entries(pkg.exports ?? {})) {
  if (typeof target !== 'string' || target.includes('*')) continue
  expect(existsSync(new URL(target, root)), `exports["${key}"] -> ${target} does not exist`)
}
for (const entry of pkg.files ?? []) {
  expect(existsSync(new URL(entry, root)), `files entry "${entry}" does not exist`)
}

expect(typeof pkg.icon === 'string', 'icon is declared')
if (typeof pkg.icon === 'string') {
  const iconPath = new URL(pkg.icon, root)
  expect(existsSync(iconPath), 'icon file exists')
  if (existsSync(iconPath)) {
    expect(statSync(iconPath).size <= 256 * 1024, 'icon is at most 256 KiB')
  }
}

const patch = await readFile(new URL('cordis.patch.yml', root), 'utf8')
expect(/^-\s*insert:/mu.test(patch), 'patch has an insert list')
expect(/id:\s*viburnum\b/u.test(patch), 'patch row id is viburnum')
expect(patch.includes(`name: '${pkg.name}'`), 'patch row names the package')

if (pkg.dsh?.client) {
  expect(pkg.dsh.client.platform === 'web', 'dsh.client platform is web')
  expect(pkg.exports['./client'] === './client.js', 'dsh.client requires the ./client export')
  const client = await readFile(new URL('./client.js', root), 'utf8')
  expect(!/^\s*(?:import|export)\s/mu.test(client), 'client.js is a classic script, not an ES module')
  expect(client.includes('__ModuleLoader__'), 'client.js registers through the module loader')
  let parses = true
  try {
    // Parse without executing: a classic script body compiles as a function body.
    new Function(client) // eslint-disable-line no-new, no-new-func
  } catch {
    parses = false
  }
  expect(parses, 'client.js parses as a classic script')
}

const locales = {}
for (const language of ['en', 'zh']) {
  locales[language] = await readJson(`locale/${language}.json`)
  const meta = locales[language].meta
  expect(typeof meta?.title === 'string' && meta.title.trim().length > 0, `${language} meta.title is non-empty`)
  expect(
    typeof meta?.description === 'string' && meta.description.trim().length > 0,
    `${language} meta.description is non-empty`,
  )
}
if (locales.en && locales.zh) {
  const en = keyPaths(locales.en).join(',')
  const zh = keyPaths(locales.zh).join(',')
  expect(en === zh, `locale key sets match (en: ${en}; zh: ${zh})`)
}

if (problems.length > 0) {
  for (const problem of problems) console.error(`check: ${problem}`)
  process.exitCode = 1
} else {
  console.log(`check: ok — ${Object.keys(pkg.exports ?? {}).length} exports, ${pkg.files.length} published entries`)
}
