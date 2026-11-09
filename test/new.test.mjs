/**
 * Scaffold checks: identity normalization and the files `vib new` writes.
 */

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

import { pluginIdentity, scaffoldPlugin } from '../lib/scaffold.js'

const CLI = fileURLToPath(new URL('../bin/vib.js', import.meta.url))

function runCli(cwd, args) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [CLI, ...args], { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('error', rejectPromise)
    child.on('close', (code) => resolvePromise({ code, stdout, stderr }))
  })
}

/** Run plain node (not the CLI) in a directory. */
function runNode(cwd, args) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, args, { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('error', rejectPromise)
    child.on('close', (code) => resolvePromise({ code, stdout, stderr }))
  })
}

test('identities follow the dsh-plugin taxonomy', () => {
  assert.deepEqual(pluginIdentity('demo'), {
    packageName: 'dsh-plugin-demo',
    slug: 'demo',
    title: 'demo',
  })
  assert.equal(pluginIdentity('Demo Plugin').packageName, 'dsh-plugin-demo-plugin')
  assert.equal(pluginIdentity('dsh-plugin-pixelart').packageName, 'dsh-plugin-pixelart')
  assert.equal(pluginIdentity('my_thing').packageName, 'dsh-plugin-my-thing')
  assert.throws(() => pluginIdentity(''), /needs a plugin name/u)
  assert.throws(() => pluginIdentity('!!!'), /is not a plugin name/u)
})

test('the scaffold writes a manifest, patch, entry, test and README', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'viburnum-new-'))
  t.after(() => rm(root, { recursive: true, force: true }))

  const result = await scaffoldPlugin({ name: 'demo', cwd: root })
  assert.equal(result.ok, true)
  assert.equal(result.package, 'dsh-plugin-demo')
  assert.equal(result.slug, 'demo')
  assert.equal(result.git, false)
  assert.deepEqual(result.files, [
    'package.json',
    'cordis.patch.yml',
    'index.js',
    'README.md',
    'test/plugin.test.mjs',
    '.gitignore',
  ])

  const pkg = JSON.parse(await readFile(join(result.dir, 'package.json'), 'utf8'))
  assert.equal(pkg.name, 'dsh-plugin-demo')
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(pkg.private, true)
  assert.match(pkg.engines.dsh, /^\^/u)

  const patch = await readFile(join(result.dir, 'cordis.patch.yml'), 'utf8')
  assert.match(patch, /- id: demo/u)
  assert.match(patch, /name: 'dsh-plugin-demo'/u)

  const entry = await readFile(join(result.dir, 'index.js'), 'utf8')
  assert.match(entry, /export const name = 'demo'/u)
  assert.match(entry, /export function apply\(ctx\)/u)

  const readme = await readFile(join(result.dir, 'README.md'), 'utf8')
  assert.match(readme, /^# dsh-plugin-demo/mu)
})

test('a scaffolded bundle passes its own test', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'viburnum-new-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const result = await scaffoldPlugin({ name: 'demo', cwd: root })

  const run = await runNode(result.dir, ['--test', join('test', 'plugin.test.mjs')])
  assert.equal(run.code, 0, run.stderr)
})

test('a non-empty target is refused', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'viburnum-new-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const target = join(root, 'dsh-plugin-demo')
  await mkdir(target, { recursive: true })
  await writeFile(join(target, 'keep.txt'), 'mine\n')

  await assert.rejects(
    scaffoldPlugin({ name: 'demo', cwd: root }),
    (error) => error.code === 'target-exists',
  )
})

test('--git initialises the scaffold and makes the first commit', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'viburnum-new-'))
  t.after(() => rm(root, { recursive: true, force: true }))

  const result = await scaffoldPlugin({ name: 'demo', cwd: root, git: true })
  assert.equal(result.git, true)
  assert.equal(result.warning, null)
  await access(join(result.dir, '.git'))
})

test('vib new writes the bundle and reports it', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'viburnum-new-'))
  t.after(() => rm(root, { recursive: true, force: true }))

  const run = await runCli(root, ['new', 'demo'])
  assert.equal(run.code, 0, run.stderr)
  assert.match(run.stdout, /created dsh-plugin-demo/u)
  assert.match(run.stdout, /cordis\.patch\.yml/u)
  const pkg = JSON.parse(await readFile(join(root, 'dsh-plugin-demo', 'package.json'), 'utf8'))
  assert.equal(pkg.name, 'dsh-plugin-demo')

  const existing = await runCli(root, ['new', 'demo'])
  assert.equal(existing.code, 1)
  assert.match(existing.stderr, /already exists/u)
})
