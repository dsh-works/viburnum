/**
 * Create a GitHub repository for a scaffolded bundle and push its first commit.
 *
 * Only creation and the initial push happen here. Nothing is deleted, and a
 * repository created before a failed push stays on GitHub with the failure
 * reported (the caller tells the user exactly that).
 *
 * @module viburnum/lib/create
 */

import { git, must } from './git.js'

/** A GitHub owner name. */
const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/u

/** A repository name the API accepts. */
const REPOSITORY = /^[A-Za-z0-9._-]+$/u

/** GitHub API headers for one write. */
function headers(token) {
  const value = {
    accept: 'application/vnd.github+json',
    'content-type': 'application/json',
    'user-agent': 'dsh-plugin-viburnum',
  }
  if (typeof token === 'string' && token.trim() !== '') value.authorization = `Bearer ${token.trim()}`
  return value
}

/** One readable failure from a GitHub write. */
function createError(code, message, extra = {}) {
  return { ok: false, code, message, ...extra }
}

/**
 * Create one repository in an organisation (or the authenticated user's
 * account when the owner is a user).
 *
 * @param {string} owner - GitHub owner name.
 * @param {string} name - repository name.
 * @param {{ private?: boolean, description?: string | null, token?: string | null, fetchImpl?: typeof fetch }} [options] - creation request.
 * @returns {Promise<object>} `{ ok: true, fullName, htmlUrl, cloneUrl }` or a refusal.
 */
export async function createRepository(owner, name, {
  private: isPrivate = true,
  description = null,
  token = null,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (typeof owner !== 'string' || !OWNER.test(owner)) return createError('invalid-owner', `"${String(owner)}" is not a GitHub owner name`)
  if (typeof name !== 'string' || !REPOSITORY.test(name)) return createError('invalid-repository', `"${String(name)}" is not a repository name`)
  if (typeof fetchImpl !== 'function') return createError('create-unavailable', 'this Host has no fetch implementation')

  const body = { name, private: isPrivate === true, auto_init: false }
  if (typeof description === 'string' && description.trim() !== '') body.description = description.trim()

  let lastStatus = 0
  for (const endpoint of [
    `https://api.github.com/orgs/${encodeURIComponent(owner)}/repos`,
    'https://api.github.com/user/repos',
  ]) {
    let response
    try {
      response = await fetchImpl(endpoint, { method: 'POST', headers: headers(token), body: JSON.stringify(body) })
    } catch (error) {
      return createError('create-network', `cannot reach GitHub: ${error.message}`)
    }
    lastStatus = response.status
    if (endpoint.includes('/orgs/') && response.status === 404) continue
    if (!response.ok) {
      let message = `GitHub answered ${response.status}`
      try {
        const payload = await response.json()
        if (typeof payload?.message === 'string') message = `${message}: ${payload.message}`
      } catch {
        // Keep the status message.
      }
      return createError('create-http', message, { status: response.status })
    }
    let created
    try {
      created = await response.json()
    } catch (error) {
      return createError('create-http', `GitHub returned unreadable JSON: ${error.message}`)
    }
    return {
      ok: true,
      fullName: created.full_name ?? `${owner}/${name}`,
      htmlUrl: created.html_url ?? null,
      cloneUrl: created.clone_url ?? `https://github.com/${owner}/${name}.git`,
      private: created.private === true,
    }
  }
  return createError('create-http', `GitHub answered ${lastStatus}`)
}

/** Make sure the directory is a git repository on a branch. */
async function ensureRepository(dir) {
  const check = await git(dir, ['rev-parse', '--git-dir'])
  if (check.code === 0) return
  const init = await git(dir, ['init', '-b', 'main'])
  if (init.code !== 0) throw new Error((init.stderr || '').trim() || 'git init failed')
}

/**
 * Commit any pending scaffold files, point origin at the new repository and
 * push the first commit to `main`.
 *
 * @param {{ dir: string, repoUrl: string, name?: string }} request - publish request.
 * @returns {Promise<{ ok: true } | { ok: false, code: 'publish-failed', message: string }>} the result.
 */
export async function publishScaffold({ dir, repoUrl, name = 'bundle' }) {
  try {
    await ensureRepository(dir)

    const status = await git(dir, ['status', '--porcelain'])
    if (status.code !== 0) throw new Error((status.stderr || '').trim() || 'git status failed')
    if (status.stdout.trim() !== '') {
      await must(dir, ['add', '-A'])
      const commit = await git(dir, ['commit', '-m', `Scaffold ${name}`])
      if (commit.code !== 0) throw new Error((commit.stderr || '').trim() || 'git commit failed')
    }

    const existing = await git(dir, ['remote', 'get-url', 'origin'])
    if (existing.code === 0) await must(dir, ['remote', 'set-url', 'origin', repoUrl])
    else await must(dir, ['remote', 'add', 'origin', repoUrl])

    const pushed = await git(dir, ['push', '-u', 'origin', 'HEAD:main'], { timeoutMs: 120_000 })
    if (pushed.code !== 0) throw new Error((pushed.stderr || '').trim() || 'git push failed')
    return { ok: true }
  } catch (error) {
    return { ok: false, code: 'publish-failed', message: error.message }
  }
}
