/**
 * The organisation catalog: list the repositories of the configured GitHub
 * owners so the install form can offer one to clone.
 *
 * Only public metadata is read. A network failure is reported per owner and
 * never fails the whole page; the core caches successful answers.
 *
 * @module viburnum/lib/catalog
 */

/** How long one owner's repository list stays fresh. */
export const CATALOG_TTL_MS = 10 * 60 * 1000

/** One typed catalog failure with a code the page can word. */
function catalogError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

/** Keep one repository from an API answer in the page's shape. */
function repoOf(entry) {
  return {
    name: typeof entry?.name === 'string' ? entry.name : '',
    fullName: typeof entry?.full_name === 'string' ? entry.full_name : '',
    description: typeof entry?.description === 'string' ? entry.description : null,
    defaultBranch: typeof entry?.default_branch === 'string' ? entry.default_branch : null,
    archived: entry?.archived === true,
    updatedAt: typeof entry?.updated_at === 'string' ? entry.updated_at : null,
  }
}

/**
 * Ask GitHub for one owner's repositories: an organisation first, a user page
 * as the fallback when the owner is not an organisation.
 *
 * @param {string} owner - GitHub owner name.
 * @param {{ token?: string | null, fetchImpl?: typeof fetch, signal?: AbortSignal }} [options] - overrides.
 * @returns {Promise<Array<object>>} the repositories, newest-updated first as GitHub returns them.
 * @throws a coded error when GitHub refuses or the answer is not a list.
 */
export async function fetchOwnerRepos(owner, { token = null, fetchImpl = globalThis.fetch, signal } = {}) {
  if (typeof owner !== 'string' || owner.trim() === '') {
    throw catalogError('invalid-owner', 'owner must be a GitHub owner name')
  }
  if (typeof fetchImpl !== 'function') {
    throw catalogError('catalog-unavailable', 'this Host has no fetch implementation')
  }

  const headers = {
    accept: 'application/vnd.github+json',
    'user-agent': 'dsh-plugin-viburnum',
  }
  if (typeof token === 'string' && token.trim() !== '') headers.authorization = `Bearer ${token.trim()}`

  let lastStatus = 0
  for (const kind of ['orgs', 'users']) {
    const url = `https://api.github.com/${kind}/${encodeURIComponent(owner)}/repos?per_page=100&sort=updated`
    let response
    try {
      response = await fetchImpl(url, { headers, signal })
    } catch (error) {
      throw catalogError('catalog-network', `cannot reach GitHub for ${owner}: ${error.message}`)
    }
    lastStatus = response.status
    if (kind === 'orgs' && response.status === 404) continue
    if (!response.ok) {
      throw catalogError('catalog-http', `GitHub answered ${response.status} for ${owner}`)
    }
    let body
    try {
      body = await response.json()
    } catch (error) {
      throw catalogError('catalog-http', `GitHub returned unreadable JSON for ${owner}: ${error.message}`)
    }
    if (!Array.isArray(body)) {
      throw catalogError('catalog-http', `GitHub returned no repository list for ${owner}`)
    }
    return body.map(repoOf).filter((entry) => entry.name !== '' && entry.fullName !== '')
  }
  throw catalogError('catalog-http', `GitHub answered ${lastStatus} for ${owner}`)
}
