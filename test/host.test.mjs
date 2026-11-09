/**
 * Host-entry checks for the viburnum bundle.
 *
 * The profile composes its entries concurrently, so the Host half must not
 * read optional services once at apply time: with no `webServer` there yet,
 * the page transport would never be registered and the browser half would
 * report "The Host did not answer." These tests drive `apply` with a fake
 * context, no harness and no browser.
 */

import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { apply } from '../index.js'

/** A logger sink that never writes to the console. */
function silentLogger() {
  return { debug() {}, info() {}, warn() {}, error() {} }
}

/** A fake Host context that records effects, tools, sections and injections. */
function makeContext() {
  const effects = []
  const injected = []
  const tools = []
  const ctx = {
    logger: () => silentLogger(),
    effect(callback) {
      const dispose = callback()
      effects.push(typeof dispose === 'function' ? dispose : () => {})
      return () => {}
    },
    get: () => undefined,
    inject(deps, callback) {
      injected.push({ deps, callback })
      return {}
    },
    tools: {
      register(tool) {
        tools.push(tool)
        return () => {}
      },
    },
    systemPrompt: { section: () => () => {} },
    pluginManager: {},
  }
  return { ctx, effects, injected, tools }
}

test('the page transport waits for the web server instead of reading it once', async () => {
  const stateDir = await mkdtemp(join(tmpdir(), 'viburnum-host-'))
  process.env.VIBURNUM_STATE_DIR = stateDir
  const { ctx, injected, effects } = makeContext()
  try {
    apply(ctx, {})

    assert.equal(injected.length, 1, 'the carrier is an optional service declared with ctx.inject')
    assert.deepEqual(injected[0].deps, ['webServer'])

    const routes = []
    const webCtx = {
      webServer: {
        register(route) {
          routes.push(route)
          return () => {}
        },
      },
      effect(callback) {
        callback()
        return () => {}
      },
    }
    injected[0].callback(webCtx)

    assert.deepEqual(
      routes.map((route) => route.path).sort(),
      ['/viburnum/action', '/viburnum/status'],
      'both page-transport routes are registered once the carrier is available',
    )
  } finally {
    // Disposing the effects stops the background check timer even when an
    // assertion above failed, so a red run exits instead of waiting 5 minutes.
    for (const dispose of effects) dispose()
    delete process.env.VIBURNUM_STATE_DIR
    await rm(stateDir, { recursive: true, force: true })
  }
})
