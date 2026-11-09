/**
 * The CLI face: same core, no harness, fixture profile and real processes.
 */

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { test } from 'node:test'

import { makeWorld, run } from './fixtures.mjs'

const CLI = fileURLToPath(new URL('../bin/vib.js', import.meta.url))

/** Create the fixture profile's package.json linking the two clones. */
async function makeProfile(world, home) {
  const profileDir = join(home, 'profiles', 'web')
  await mkdir(profileDir, { recursive: true })
  await writeFile(join(profileDir, 'package.json'), JSON.stringify({
    dependencies: {
      'dsh-plugin-laptop': `link:${world.laptop}`,
      'dsh-plugin-work': `link:${world.work}`,
    },
    dsh: { profile: { bundles: ['dsh-plugin-laptop', 'dsh-plugin-work'] } },
  }))
}

/** Raise one fixture world plus the environment the CLI reads. */
async function setup(t) {
  const world = await makeWorld(t)
  const home = join(world.root, 'home')
  const stateDirectory = await mkdtemp(join(tmpdir(), 'viburnum-cli-'))
  t.after(() => rm(stateDirectory, { recursive: true, force: true }))
  await makeProfile(world, home)

  const env = {
    ...process.env,
    DSH_HOME: home,
    DSH_PROFILE: 'web',
    VIBURNUM_STATE_DIR: stateDirectory,
  }
  delete env.DSH_PROFILE_DIR
  delete env.DSH_WEB_URL

  return { world, home, stateDirectory, env }
}

/** Run the CLI and collect its exit code and streams. */
function runCli(env, args) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
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

test('refresh lists the mounted bundles and status reports them', async (t) => {
  const { world, env } = await setup(t)

  const refreshed = await runCli(env, ['refresh', '--json'])
  assert.equal(refreshed.code, 0)
  const snapshot = JSON.parse(refreshed.stdout)
  assert.equal(snapshot.rows.length, 2)
  assert.equal(snapshot.dot, 'green')
  assert.deepEqual(snapshot.rows.map((row) => row.status), ['current', 'current'])

  const status = await runCli(env, ['status', '--json'])
  assert.equal(status.code, 0)
  assert.equal(JSON.parse(status.stdout).rows.length, 2)

  assert.equal(await world.head(world.work), await world.head(world.laptop))
})

test('pending work exits 3, and sync closes the loop', async (t) => {
  const { world, env } = await setup(t)

  await world.commit(world.laptop, 'a.txt', 'a\n', 'laptop one')
  await world.push(world.laptop)

  const refreshed = await runCli(env, ['refresh', '--json'])
  assert.equal(refreshed.code, 3)
  const snapshot = JSON.parse(refreshed.stdout)
  const workRow = snapshot.rows.find((row) => row.name === 'dsh-plugin-work')
  assert.equal(workRow.status, 'remote-ahead')
  assert.equal(workRow.behind, 1)

  const synced = await runCli(env, ['sync', 'dsh-plugin-work', '--json'])
  assert.equal(synced.code, 0)
  const result = JSON.parse(synced.stdout)
  assert.equal(result.ok, true)
  assert.equal(result.receipt.pulled, 1)
  assert.equal(await world.head(world.work), await world.head(world.laptop))

  const finalStatus = await runCli(env, ['status', '--json'])
  assert.equal(finalStatus.code, 0)
})

test('update fast-forwards one bundle from the command line', async (t) => {
  const { world, env } = await setup(t)

  await world.commit(world.laptop, 'a.txt', 'a\n', 'laptop one')
  await world.push(world.laptop)

  const updated = await runCli(env, ['update', 'dsh-plugin-work', '--json'])
  assert.equal(updated.code, 0)
  const result = JSON.parse(updated.stdout)
  assert.equal(result.ok, true)
  assert.equal(result.receipt.kind, 'update')
  assert.equal(await world.head(world.work), await world.head(world.laptop))
})

test('a dry-run sync plans without moving anything', async (t) => {
  const { world, env } = await setup(t)

  await world.commit(world.laptop, 'a.txt', 'a\n', 'laptop one')
  await world.push(world.laptop)
  const before = await world.head(world.work)

  const planned = await runCli(env, ['sync', '--dry-run', '--json'])
  assert.equal(planned.code, 0)
  const result = JSON.parse(planned.stdout)
  assert.ok(result.results.some((row) => row.plan?.action === 'pull'))
  assert.equal(await world.head(world.work), before)
})

test('switch moves one bundle to a track from the command line', async (t) => {
  const { world, env } = await setup(t)

  await run(world.laptop, ['switch', '-c', 'dev'])
  await world.commit(world.laptop, 'client.js', 'void 0\n', 'dev change')
  await run(world.laptop, ['push', '-u', 'origin', 'dev'])

  const switched = await runCli(env, ['switch', 'dsh-plugin-work', 'dev', '--json'])
  assert.equal(switched.code, 0)
  assert.equal(JSON.parse(switched.stdout).ok, true)
  assert.equal(await world.branch(world.work), 'dev')
})

test('the CLI banner is the lowercase backronym', async (t) => {
  const { env } = await setup(t)
  const tagline = 'vib - keeps all linked installs neatly synced in two universes'

  const help = await runCli(env, ['--help'])
  assert.equal(help.stdout.split(/\r?\n/u)[0], tagline)

  const bare = await runCli(env, [])
  assert.equal(bare.stdout.split(/\r?\n/u)[0], tagline)
})

test('an unknown command fails with usage', async (t) => {
  const { env } = await setup(t)

  const result = await runCli(env, ['frobnicate'])
  assert.equal(result.code, 1)
  assert.match(result.stderr, /unknown command/u)
  assert.match(result.stdout, /Usage/u)
})

/** Start one stub page route and return its origin plus the recorded requests. */
async function makeHost(t, responder = () => ({ ok: true, installed: true, name: 'dsh-plugin-new', version: '0.1.0' })) {
  const requests = []
  const server = createServer((request, response) => {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', (chunk) => { body += chunk })
    request.on('end', () => {
      let parsed = null
      try {
        parsed = JSON.parse(body)
      } catch {
        parsed = null
      }
      requests.push({ url: request.url, method: request.method, headers: request.headers, body: parsed })
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify(responder(parsed)))
    })
  })
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen))
  t.after(() => new Promise((resolveClose) => server.close(resolveClose)))
  const { port } = server.address()
  return { origin: `http://127.0.0.1:${port}`, requests }
}

test('install sends the resolved directory door to the Host route', async (t) => {
  const host = await makeHost(t)
  const plugin = await mkdtemp(join(tmpdir(), 'viburnum-cli-plugin-'))
  t.after(() => rm(plugin, { recursive: true, force: true }))

  const env = { ...process.env, VIBURNUM_HOST: host.origin }
  const result = await runCli(env, ['install', plugin])

  assert.equal(result.code, 0)
  assert.match(result.stdout, /installed dsh-plugin-new v0\.1\.0/u)
  assert.equal(host.requests.length, 1)
  assert.equal(host.requests[0].url, '/viburnum/action')
  assert.equal(host.requests[0].method, 'POST')
  assert.equal(host.requests[0].headers['x-viburnum'], '1')
  assert.deepEqual(host.requests[0].body, { action: 'install', door: 'directory', spec: plugin })
})

test('install spells a repository and honours --host', async (t) => {
  const host = await makeHost(t)
  const env = { ...process.env, VIBURNUM_HOST: 'http://127.0.0.1:1' }

  const result = await runCli(env, ['install', 'dsh-works/dsh-plugin-pip', '--host', host.origin])
  assert.equal(result.code, 0)
  assert.deepEqual(host.requests[0].body, {
    action: 'install',
    door: 'repository',
    spec: 'dsh-works/dsh-plugin-pip',
  })
})

test('install prints a refusal and exits 1', async (t) => {
  const host = await makeHost(t, () => ({ ok: false, code: 'missing-directory', message: 'no package.json in C:\\nope' }))
  const plugin = await mkdtemp(join(tmpdir(), 'viburnum-cli-plugin-'))
  t.after(() => rm(plugin, { recursive: true, force: true }))

  const result = await runCli({ ...process.env, VIBURNUM_HOST: host.origin }, ['install', plugin])
  assert.equal(result.code, 1)
  assert.match(result.stderr, /install refused: missing-directory/u)
  assert.match(result.stderr, /no package\.json/u)
})

test('install without a reachable Host or an argument fails clearly', async (t) => {
  const unreachable = await runCli({ ...process.env, VIBURNUM_HOST: 'http://127.0.0.1:1' }, ['install', '.'])
  assert.equal(unreachable.code, 1)
  assert.match(unreachable.stderr, /cannot reach the viburnum Host/u)

  const missing = await runCli(process.env, ['install'])
  assert.equal(missing.code, 1)
  assert.match(missing.stderr, /install needs a path/u)
})
