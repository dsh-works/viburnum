/**
 * The CLI face: same core, no harness, fixture profile and real processes.
 */

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
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

test('an unknown command fails with usage', async (t) => {
  const { env } = await setup(t)

  const result = await runCli(env, ['frobnicate'])
  assert.equal(result.code, 1)
  assert.match(result.stderr, /unknown command/u)
  assert.match(result.stdout, /Usage/u)
})
