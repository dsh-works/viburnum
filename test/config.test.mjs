/**
 * Configuration defaults, overrides and the Standard Schema face.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { Config, DEFAULTS, resolveConfig } from '../lib/config.js'

test('defaults apply when the row has no configuration', () => {
  assert.deepEqual(resolveConfig(undefined), {
    catalogOwners: ['dsh-works'],
    pluginsDir: '',
    checkIntervalMinutes: 5,
    fetchTimeoutMs: 20_000,
  })
  assert.deepEqual(resolveConfig(null), {
    catalogOwners: ['dsh-works'],
    pluginsDir: '',
    checkIntervalMinutes: 5,
    fetchTimeoutMs: 20_000,
  })
  assert.deepEqual(DEFAULTS.catalogOwners, ['dsh-works'])
})

test('valid overrides resolve and leave the defaults untouched', () => {
  const resolved = resolveConfig({
    catalogOwners: ['dsh-works', 'example-org'],
    pluginsDir: 'D:/plugins',
    checkIntervalMinutes: 0,
    fetchIntervalMinutes: 999,
    fetchTimeoutMs: 90_000,
    id: 'viburnum',
    name: 'dsh-plugin-viburnum',
  })

  assert.deepEqual(resolved.catalogOwners, ['dsh-works', 'example-org'])
  assert.equal(resolved.pluginsDir, 'D:/plugins')
  assert.equal(resolved.checkIntervalMinutes, 0)
  assert.equal(resolved.fetchTimeoutMs, 90_000)
  assert.deepEqual(DEFAULTS.catalogOwners, ['dsh-works'], 'defaults stay a fresh value')

  resolved.catalogOwners.push('mutated')
  assert.deepEqual(DEFAULTS.catalogOwners, ['dsh-works'])
})

test('catalog owners are trimmed and de-duplicated case-insensitively', () => {
  const resolved = resolveConfig({ catalogOwners: [' dsh-works ', 'DSH-WORKS', 'Ivan-Iliev'] })
  assert.deepEqual(resolved.catalogOwners, ['dsh-works', 'Ivan-Iliev'])
})

test('invalid values are rejected with an actionable message', () => {
  const cases = [
    [{ checkIntervalMinutes: -1 }, /config\.checkIntervalMinutes/u],
    [{ checkIntervalMinutes: 1441 }, /config\.checkIntervalMinutes/u],
    [{ fetchTimeoutMs: 10 }, /config\.fetchTimeoutMs/u],
    [{ catalogOwners: 'dsh-works' }, /config\.catalogOwners/u],
    [{ catalogOwners: ['bad name'] }, /config\.catalogOwners/u],
    [{ catalogOwners: [''] }, /config\.catalogOwners/u],
    [{ pluginsDir: 5 }, /config\.pluginsDir/u],
  ]
  for (const [input, pattern] of cases) {
    assert.throws(() => resolveConfig(input), pattern)
  }
})

test('the Standard Schema face reports issues instead of throwing', () => {
  const accepted = Config['~standard'].validate({ checkIntervalMinutes: 10, id: 'viburnum' })
  assert.ok('value' in accepted)
  assert.equal(accepted.value.id, 'viburnum')

  const refused = Config['~standard'].validate({ checkIntervalMinutes: 99_999 })
  assert.ok(Array.isArray(refused.issues))
  assert.match(refused.issues[0].message, /config\.checkIntervalMinutes/u)

  assert.deepEqual(Config['~standard'].validate(undefined), { value: {} })
  assert.deepEqual(Config['~standard'].validate({}), { value: {} })
})
