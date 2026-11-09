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

/** How many pages of 100 repositories one owner read may take. */
export const MAX_PAGES = 5

/** Largest README payload the preview hands to the page. */
export const MAX_README_BYTES = 200_000

/** Largest icon payload inlined into the catalog. */
export const MAX_ICON_BYTES = 200_000

/** Icon media types the catalog can inline. */
const ICON_MIME = {
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
}

const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/u
const REPOSITORY = /^[A-Za-z0-9._-]+$/u

/** GitHub API headers for one read. */
function apiHeaders(token, raw) {
  const headers = {
    accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
    'user-agent': 'dsh-plugin-viburnum',
  }
  if (typeof token === 'string' && token.trim() !== '') headers.authorization = `Bearer ${token.trim()}`
  return headers
}

/** Validate an owner/repo pair and read one API URL. */
async function apiGet(url, { token, fetchImpl = globalThis.fetch, raw, signal }) {
  if (typeof fetchImpl !== 'function') throw catalogError('catalog-unavailable', 'this Host has no fetch implementation')
  let response
  try {
    response = await fetchImpl(url, { headers: apiHeaders(token, raw), signal })
  } catch (error) {
    throw catalogError('catalog-network', `cannot reach GitHub: ${error.message}`)
  }
  return response
}

/** Read and parse a repository's package.json through the contents API. */
export async function fetchRepoManifest(owner, repo, options = {}) {
  if (!OWNER.test(String(owner ?? '')) || !REPOSITORY.test(String(repo ?? ''))) {
    throw catalogError('invalid-owner', 'owner or repository name is not valid')
  }
  const response = await apiGet(
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/package.json`,
    { ...options, raw: true },
  )
  if (!response.ok) throw catalogError('catalog-http', `GitHub answered ${response.status} for ${owner}/${repo}`)
  const text = await response.text()
  try {
    return JSON.parse(text)
  } catch (error) {
    throw catalogError('catalog-http', `package.json in ${owner}/${repo} is not JSON: ${error.message}`)
  }
}

/** Read one repository's declared icon without cloning it. */
export async function fetchRepoIcon(owner, repo, options = {}) {
  const pkg = await fetchRepoManifest(owner, repo, options)
  const exported = typeof pkg?.exports?.['./icon'] === 'string' ? pkg.exports['./icon'] : ''
  const declared = typeof pkg?.icon === 'string' ? pkg.icon.trim() : exported.trim()
  if (declared === '') return { ok: true, icon: null, path: null }
  const mime = ICON_MIME[declared.slice(declared.lastIndexOf('.')).toLowerCase()]
  if (mime === undefined) return { ok: true, icon: null, path: declared }

  const clean = declared.replace(/^\.?\//u, '').replace(/^\/+/u, '')
  if (clean === '') return { ok: true, icon: null, path: declared }
  const path = clean.split('/').map((part) => encodeURIComponent(part)).join('/')
  const response = await apiGet(
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path}`,
    { ...options, raw: true },
  )
  if (!response.ok) throw catalogError('catalog-http', `GitHub answered ${response.status} for ${owner}/${repo} ${declared}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.length > MAX_ICON_BYTES) return { ok: true, icon: null, path: declared }
  return { ok: true, icon: `data:${mime};base64,${bytes.toString('base64')}`, path: declared }
}

/** Read a repository's README and manifest facts without installing it. */
export async function fetchRepoPreview(owner, repo, options = {}) {
  if (!OWNER.test(String(owner ?? '')) || !REPOSITORY.test(String(repo ?? ''))) {
    throw catalogError('invalid-owner', 'owner or repository name is not valid')
  }
  const response = await apiGet(
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/readme`,
    { ...options, raw: true },
  )
  if (!response.ok) throw catalogError('catalog-http', `GitHub answered ${response.status} for ${owner}/${repo} README`)
  const text = await response.text()
  const truncated = text.length > MAX_README_BYTES
  const readme = truncated ? text.slice(0, MAX_README_BYTES) : text

  let pkg = null
  try {
    pkg = await fetchRepoManifest(owner, repo, options)
  } catch {
    pkg = null
  }
  return {
    ok: true,
    owner,
    repo,
    readme,
    truncated,
    name: typeof pkg?.name === 'string' ? pkg.name : null,
    version: typeof pkg?.version === 'string' ? pkg.version : null,
    description: typeof pkg?.description === 'string' ? pkg.description : null,
    enginesDsh: typeof pkg?.engines?.dsh === 'string' ? pkg.engines.dsh : null,
  }
}

/** Keep one repository from an API answer in the page's shape. */
function repoOf(entry) {
  return {
    name: typeof entry?.name === 'string' ? entry.name : '',
    fullName: typeof entry?.full_name === 'string' ? entry.full_name : '',
    description: typeof entry?.description === 'string' ? entry.description : null,
    defaultBranch: typeof entry?.default_branch === 'string' ? entry.default_branch : null,
    archived: entry?.archived === true,
    private: entry?.private === true,
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
    const baseUrl = `https://api.github.com/${kind}/${encodeURIComponent(owner)}/repos?per_page=100&sort=updated`
    const repos = []
    let usable = true
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const url = page === 1 ? baseUrl : `${baseUrl}&page=${page}`
      let response
      try {
        response = await fetchImpl(url, { headers, signal })
      } catch (error) {
        throw catalogError('catalog-network', `cannot reach GitHub for ${owner}: ${error.message}`)
      }
      lastStatus = response.status
      if (kind === 'orgs' && page === 1 && response.status === 404) {
        usable = false
        break
      }
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
      repos.push(...body)
      if (body.length < 100) break
    }
    if (!usable) continue
    return repos.map(repoOf).filter((entry) => entry.name !== '' && entry.fullName !== '')
  }
  throw catalogError('catalog-http', `GitHub answered ${lastStatus} for ${owner}`)
}
