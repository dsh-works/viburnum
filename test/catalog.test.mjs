/**
 * Organisation catalog checks: the GitHub answer mapping, its fallback, and
 * the core's cache. No network is used.
 */

import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { createCore } from '../lib/core.js'
import { fetchOwnerRepos, fetchRepoIcon, fetchRepoPreview } from '../lib/catalog.js'

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body
    },
  }
}

function rawResponse(body, status = 200) {
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(String(body))
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return bytes.toString('utf8')
    },
    async arrayBuffer() {
      return bytes
    },
  }
}

test('organisation repositories are mapped and the token is sent', async () => {
  const calls = []
  const fetchImpl = async (url, options) => {
    calls.push({ url, headers: options.headers })
    return jsonResponse([
      {
        name: 'dsh-plugin-pip',
        full_name: 'dsh-works/dsh-plugin-pip',
        description: 'Pip',
        default_branch: 'main',
        archived: false,
        updated_at: '2026-11-01T00:00:00Z',
      },
      { name: '', full_name: '' },
    ])
  }

  const repos = await fetchOwnerRepos('dsh-works', { fetchImpl, token: 'sekret' })
  assert.equal(repos.length, 1)
  assert.equal(repos[0].fullName, 'dsh-works/dsh-plugin-pip')
  assert.equal(repos[0].defaultBranch, 'main')
  assert.equal(calls[0].headers.authorization, 'Bearer sekret')
  assert.match(calls[0].url, /\/orgs\/dsh-works\/repos/u)
})

test('a user owner falls back from /orgs to /users', async () => {
  const calls = []
  const fetchImpl = async (url) => {
    calls.push(url)
    if (url.includes('/orgs/')) return jsonResponse({ message: 'Not Found' }, 404)
    return jsonResponse([{ name: 'mine', full_name: 'ivan/mine', default_branch: 'dev', archived: false }])
  }

  const repos = await fetchOwnerRepos('ivan', { fetchImpl })
  assert.equal(repos.length, 1)
  assert.equal(repos[0].fullName, 'ivan/mine')
  assert.equal(calls.length, 2)
  assert.match(calls[1], /\/users\/ivan\/repos/u)
})

test('catalog pages are followed until a short page', async () => {
  const calls = []
  const fullPage = Array.from({ length: 100 }, (_, index) => ({
    name: 'repo-' + index,
    full_name: 'dsh-works/repo-' + index,
    description: null,
    default_branch: 'main',
    archived: false,
    private: index === 0,
  }))
  const fetchImpl = async (url) => {
    calls.push(url)
    return jsonResponse(url.includes('page=2') ? [{ name: 'last', full_name: 'dsh-works/last', default_branch: 'main' }] : fullPage)
  }

  const repos = await fetchOwnerRepos('dsh-works', { fetchImpl })
  assert.equal(repos.length, 101)
  assert.equal(repos[0].private, true)
  assert.equal(calls.length, 2)
  assert.match(calls[1], /page=2/u)
})

test('icons and previews are read without cloning the repository', async () => {
  const calls = []
  const fetchImpl = async (url, options) => {
    calls.push({ url, accept: options.headers.accept })
    if (url.endsWith('/contents/package.json')) {
      return rawResponse(JSON.stringify({
        name: 'dsh-plugin-x',
        version: '1.2.3',
        description: 'an x plugin',
        icon: './icon.svg',
        engines: { dsh: '^0.2.1-rc.2' },
      }))
    }
    if (url.endsWith('/contents/icon.svg')) return rawResponse('<svg xmlns="http://www.w3.org/2000/svg"/>')
    if (url.endsWith('/readme')) return rawResponse('# dsh-plugin-x\n\nHello.')
    return rawResponse('not found', 404)
  }

  const icon = await fetchRepoIcon('dsh-works', 'dsh-plugin-x', { fetchImpl, token: 'sekret' })
  assert.equal(icon.ok, true)
  assert.match(icon.icon, /^data:image\/svg\+xml;base64,/u)
  assert.match(calls[0].accept, /raw/u)
  assert.ok(calls.every((call) => call.url.includes('/repos/dsh-works/dsh-plugin-x/')))

  const preview = await fetchRepoPreview('dsh-works', 'dsh-plugin-x', { fetchImpl })
  assert.equal(preview.ok, true)
  assert.equal(preview.name, 'dsh-plugin-x')
  assert.equal(preview.version, '1.2.3')
  assert.equal(preview.enginesDsh, '^0.2.1-rc.2')
  assert.match(preview.readme, /Hello/u)
  assert.equal(preview.truncated, false)
})

test('catalog failures carry readable codes', async () => {
  await assert.rejects(
    fetchOwnerRepos('dsh-works', { fetchImpl: async () => jsonResponse({}, 403) }),
    (error) => error.code === 'catalog-http',
  )
  await assert.rejects(
    fetchOwnerRepos('dsh-works', { fetchImpl: async () => { throw new Error('offline') } }),
    (error) => error.code === 'catalog-network',
  )
  await assert.rejects(
    fetchOwnerRepos('  ', { fetchImpl: async () => jsonResponse([]) }),
    (error) => error.code === 'invalid-owner',
  )
})

async function makeCore(t, { catalogFetcher } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'viburnum-catalog-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const core = createCore({
    bundleSource: async () => ({ profileDir: root, bundles: [] }),
    env: { DSH_HOME: root },
    catalogFetcher,
  })
  await core.load()
  return { root, core }
}

test('the catalog caches successes and honours a refresh', async (t) => {
  let calls = 0
  const { core } = await makeCore(t, {
    catalogFetcher: async (owner) => {
      calls += 1
      return [{ name: owner + '-plugin', fullName: owner + '/' + owner + '-plugin' }]
    },
  })

  const first = await core.catalog()
  assert.equal(first.ok, true)
  assert.equal(first.owners[0].owner, 'dsh-works')
  assert.equal(first.owners[0].cached, false)
  assert.equal(calls, 1)

  const second = await core.catalog()
  assert.equal(second.owners[0].cached, true)
  assert.equal(calls, 1)

  await core.catalog({ refresh: true })
  assert.equal(calls, 2)
})

test('one owner failure does not hide the others and is retried later', async (t) => {
  const { core } = await makeCore(t, {
    catalogFetcher: async (owner) => {
      if (owner === 'bad') throw new Error('GitHub said no')
      return [{ name: 'ok', fullName: owner + '/ok' }]
    },
  })

  const result = await core.catalog({ owners: ['good', 'bad'] })
  assert.equal(result.ok, true)
  assert.equal(result.owners[0].repos.length, 1)
  assert.equal(result.owners[1].error, 'GitHub said no')
  assert.deepEqual(result.owners[1].repos, [])

  const cached = await core.catalog({ owners: ['bad'] })
  assert.equal(cached.owners[0].cached, true)
  assert.equal(cached.owners[0].error, 'GitHub said no')
})

test('a Host without a catalog fetcher refuses cleanly', async (t) => {
  const { core } = await makeCore(t)
  const result = await core.catalog()
  assert.equal(result.ok, false)
  assert.equal(result.code, 'catalog-unavailable')
})
