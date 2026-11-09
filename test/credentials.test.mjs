/**
 * Credential parsing checks. The helper itself is interactive and not spawned
 * here; the pure parser owns the shape.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { parseCredentialOutput } from '../lib/credentials.js'

test('git credential output keeps the username and password', () => {
  const parsed = parseCredentialOutput('protocol=https\nhost=github.com\nusername=someone\npassword=token-value\n')
  assert.deepEqual(parsed, { username: 'someone', password: 'token-value' })
})

test('missing or empty fields become nulls', () => {
  assert.deepEqual(parseCredentialOutput(''), { username: null, password: null })
  assert.deepEqual(parseCredentialOutput('protocol=https\nhost=github.com\npassword=\n'), { username: null, password: null })
  assert.deepEqual(parseCredentialOutput('garbage\n=value\n'), { username: null, password: null })
})
