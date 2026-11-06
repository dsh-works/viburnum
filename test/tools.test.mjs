/**
 * The tool contract: names, schemas, approval gates and canonical values.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { buildTools } from '../lib/tools.js'

/** A Host context stub: approval can be present, absent or refusing. */
function context({ approval } = {}) {
  return {
    get(value) {
      if (value === 'approval') return approval
      return undefined
    },
  }
}

/** A core stub recording calls and returning deterministic values. */
function coreStub() {
  const calls = []
  return {
    calls,
    snapshot: () => ({ rows: [{ name: 'a', track: 'main', ahead: 0, behind: 0, status: 'current' }], dot: 'green', checkedAt: 'now' }),
    update: async (name) => {
      calls.push(['update', name])
      return { name: name ?? 'all', ok: true, receipt: { kind: 'update', pushed: 0, pulled: 1, rebased: 0 } }
    },
    sync: async (name, options) => {
      calls.push(['sync', name, options])
      if (options?.dryRun) return { ok: true, dryRun: true, plan: { action: 'pull', pulled: 1 } }
      return { name: name ?? 'all', ok: true, receipt: { kind: 'sync', pushed: 1, pulled: 0, rebased: 0 } }
    },
    switch: async (name, track) => {
      calls.push(['switch', name, track])
      return { name, ok: true, receipt: { kind: 'switch', pushed: 0, pulled: 0, rebased: 0, track } }
    },
    revert: async (name) => {
      calls.push(['revert', name])
      return { name, ok: true, receipt: { kind: 'revert', pushed: 0, pulled: 0, rebased: 0 } }
    },
  }
}

/** The tools built over the stubs. */
function tools(options = {}) {
  return buildTools({ ctx: options.ctx ?? context(), core: options.core ?? coreStub(), ready: options.ready ?? Promise.resolve(null) })
}

test('every tool declares its name, parameters and output contract', () => {
  const definitions = tools()
  assert.deepEqual(definitions.map((tool) => tool.name), [
    'vib_status',
    'vib_update',
    'vib_sync',
    'vib_switch',
    'vib_revert',
  ])

  for (const tool of definitions) {
    assert.ok(tool.description.length > 40, `${tool.name} needs a real description`)
    assert.equal(typeof tool.execute, 'function')
    assert.equal(typeof tool.parameters, 'object')
    assert.equal(tool.output.schema.type, 'object')
    assert.equal(typeof tool.output.render, 'function')
    const blocks = tool.output.render({}, { ok: true })
    assert.equal(blocks[0].type, 'text')
  }
})

test('vib_status reads the core cache without approval', async () => {
  const definitions = tools()
  const status = definitions.find((tool) => tool.name === 'vib_status')
  const value = await status.execute({}, { signal: new AbortController().signal })
  assert.equal(value.dot, 'green')
  assert.equal(value.rows.length, 1)
  assert.match(status.output.render({}, value)[0].text, /a — main ✓ current/u)
})

test('mutating tools ask for approval and refuse when it is not granted', async () => {
  const calls = []
  const refusing = context({ approval: { request: async () => 'rejected' } })
  const core = coreStub()
  const definitions = tools({ ctx: refusing, core })

  for (const name of ['vib_update', 'vib_sync', 'vib_switch', 'vib_revert']) {
    const tool = definitions.find((candidate) => candidate.name === name)
    const args = name === 'vib_switch'
      ? { bundle: 'a', track: 'dev' }
      : { bundle: 'a' }
    const value = await tool.execute(args, { agent: { id: 'agent' }, callId: 'call', signal: new AbortController().signal })
    assert.equal(value.ok, false, name)
    assert.equal(value.code, 'approval-rejected', name)
    calls.push(name)
  }
  assert.equal(core.calls.length, 0, 'a refused tool must not move anything')
  assert.equal(calls.length, 4)
})

test('an approved move runs and a dry run skips approval', async () => {
  const core = coreStub()
  const approving = context({ approval: { request: async () => 'allowed-once' } })
  const definitions = tools({ ctx: approving, core })

  const sync = definitions.find((tool) => tool.name === 'vib_sync')
  const executed = await sync.execute(
    { bundle: 'a' },
    { agent: { id: 'agent' }, callId: 'call', signal: new AbortController().signal },
  )
  assert.equal(executed.ok, true)
  assert.deepEqual(core.calls[0], ['sync', 'a', { dryRun: false }])

  const dry = await sync.execute(
    { bundle: 'a', dry_run: true },
    { agent: { id: 'agent' }, callId: 'call', signal: new AbortController().signal },
  )
  assert.equal(dry.dryRun, true)
  assert.deepEqual(core.calls[1], ['sync', 'a', { dryRun: true }])
})

test('a missing approval service fails closed', async () => {
  const core = coreStub()
  const definitions = tools({ ctx: context(), core })
  const update = definitions.find((tool) => tool.name === 'vib_update')

  const value = await update.execute({}, { agent: { id: 'agent' }, callId: 'call', signal: new AbortController().signal })
  assert.equal(value.code, 'approval-unavailable')
  assert.equal(core.calls.length, 0)
})

test('a broken state load is reported, not thrown', async () => {
  const definitions = tools({ ready: Promise.resolve(new Error('bad state')) })
  const status = definitions.find((tool) => tool.name === 'vib_status')
  const value = await status.execute({}, { signal: new AbortController().signal })
  assert.equal(value.ok, false)
  assert.equal(value.code, 'not-ready')
})

test('batch results are rendered as one line per bundle plus totals', async () => {
  const core = coreStub()
  core.sync = async () => ({
    ok: false,
    totals: { pushed: 1, pulled: 0, rebased: 0 },
    results: [
      { name: 'a', ok: true, receipt: { kind: 'sync', pushed: 1, pulled: 0, rebased: 0 } },
      { name: 'b', ok: false, code: 'dirty', message: '2 uncommitted files' },
    ],
  })
  const definition = tools({
    core,
    ctx: context({ approval: { request: async () => 'allowed-once' } }),
  }).find((tool) => tool.name === 'vib_sync')
  const value = await definition.execute({}, { agent: { id: 'agent' }, callId: 'call', signal: new AbortController().signal })
  const rendered = definition.output.render({}, value)[0].text
  assert.match(rendered, /a: pushed 1/u)
  assert.match(rendered, /refused: dirty/u)
  assert.match(rendered, /totals: pushed 1, pulled 0, rebased 0/u)
})
