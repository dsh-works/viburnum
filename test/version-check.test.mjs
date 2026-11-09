/**
 * Version range checks: enough semver to warn about harness drift.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { compareVersions, parseVersion, satisfiesRange } from '../lib/version-check.js'

test('versions parse and compare with prereleases', () => {
  assert.deepEqual(parseVersion('0.2.2-rc.1'), { major: 0, minor: 2, patch: 2, prerelease: 'rc.1' })
  assert.equal(parseVersion('not a version'), null)
  assert.ok(compareVersions(parseVersion('0.2.2'), parseVersion('0.2.1')) > 0)
  assert.ok(compareVersions(parseVersion('0.2.2-rc.1'), parseVersion('0.2.2')) < 0)
})

test('caret and tilde ranges follow the usual bounds', () => {
  assert.equal(satisfiesRange('0.2.2-rc.1', '^0.2.1-rc.2'), true)
  assert.equal(satisfiesRange('0.3.0', '^0.2.1-rc.2'), false)
  assert.equal(satisfiesRange('1.9.9', '^1.2.3'), true)
  assert.equal(satisfiesRange('2.0.0', '^1.2.3'), false)
  assert.equal(satisfiesRange('1.2.9', '~1.2.3'), true)
  assert.equal(satisfiesRange('1.3.0', '~1.2.3'), false)
})

test('comparators, alternatives and unknown shapes', () => {
  assert.equal(satisfiesRange('0.2.2', '>=0.2.1'), true)
  assert.equal(satisfiesRange('0.2.0', '>=0.2.1'), false)
  assert.equal(satisfiesRange('0.2.2', '^0.3.0 || >=0.2.1'), true)
  assert.equal(satisfiesRange('0.2.2', '*'), true)
  assert.equal(satisfiesRange('0.2.2', ''), true)
  assert.equal(satisfiesRange('0.2.2', 'workspace:*'), true)
  assert.equal(satisfiesRange('what', '^1.0.0'), true)
})
