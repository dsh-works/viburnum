/**
 * Repository creation and initial-push checks, against stubbed GitHub and a
 * local bare repository. No real GitHub call is made.
 */

import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { createRepository, publishScaffold } from '../lib/create.js'
import { run } from './fixtures.mjs'

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body
    },
  }
}

test('a repository is created in the organisation first', async () => {
  const calls = []
  const fetchImpl = async (url, options) => {
    calls.push({ url, method: options.method, body: JSON.parse(options.body), headers: options.headers })
    return jsonResponse({ full_name: 'dsh-works/dsh-plugin-new', html_url: 'https://github.com/dsh-works/dsh-plugin-new', clone_url: 'https://github.com/dsh-works/dsh-plugin-new.git', private: true })
  }

  const created = await createRepository('dsh-works', 'dsh-plugin-new', { token: 'sekret', fetchImpl, description: 'a plugin' })
  assert.equal(created.ok, true)
  assert.equal(created.fullName, 'dsh-works/dsh-plugin-new')
  assert.equal(calls[0].url, 'https://api.github.com/orgs/dsh-works/repos')
  assert.equal(calls[0].body.private, true)
  assert.equal(calls[0].body.description, 'a plugin')
  assert.equal(calls[0].headers.authorization, 'Bearer sekret')
})

test('a user owner falls back to /user/repos', async () => {
  const calls = []
  const fetchImpl = async (url) => {
    calls.push(url)
    if (url.includes('/orgs/')) return jsonResponse({ message: 'Not Found' }, 404)
    return jsonResponse({ full_name: 'ivan/dsh-plugin-new', html_url: null, clone_url: 'https://github.com/ivan/dsh-plugin-new.git', private: true })
  }

  const created = await createRepository('ivan', 'dsh-plugin-new', { fetchImpl })
  assert.equal(created.ok, true)
  assert.equal(created.fullName, 'ivan/dsh-plugin-new')
  assert.equal(calls.length, 2)
})

test('creation failures carry readable codes', async () => {
  const refused = await createRepository('dsh-works', 'x', { fetchImpl: async () => jsonResponse({ message: 'already exists' }, 422) })
  assert.equal(refused.ok, false)
  assert.equal(refused.code, 'create-http')
  assert.match(refused.message, /already exists/u)

  const network = await createRepository('dsh-works', 'x', { fetchImpl: async () => { throw new Error('offline') } })
  assert.equal(network.code, 'create-network')

  assert.equal((await createRepository('bad owner!', 'x')).code, 'invalid-owner')
  assert.equal((await createRepository('dsh-works', 'bad name')).code, 'invalid-repository')
})

test('the scaffold is committed and pushed to a bare origin', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'viburnum-create-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const bare = join(root, 'origin.git')
  const work = join(root, 'work')
  await mkdir(work, { recursive: true })
  await run(root, ['init', '--bare', '--initial-branch=main', bare])
  await run(work, ['init', '-b', 'main'])
  await writeFile(join(work, 'README.md'), '# new plugin\n')

  const published = await publishScaffold({ dir: work, repoUrl: bare, name: 'dsh-plugin-new' })
  assert.equal(published.ok, true)
  assert.equal((await run(bare, ['rev-parse', 'main'])).length > 0, true)
})
