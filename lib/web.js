/**
 * The page's transport: two same-origin JSON routes registered on the Host.
 *
 * Out-of-tree bundles cannot add Typert Remote endpoints, so the browser half
 * reads and acts through these routes. A custom header is required: a foreign
 * page cannot send it without a CORS preflight, so a cross-site form cannot act.
 *
 * @module viburnum/lib/web
 */

/** Route prefix owned by this bundle. */
export const PREFIX = '/viburnum'

/** Request header that marks a same-origin client of this plugin. */
export const HEADER = 'x-viburnum'

/** Header the browser half adds, so the probe can tell a browser fetch apart. */
export const CLIENT_HEADER = 'x-viburnum-client'

/** JSON body cap for one action. */
const MAX_BODY_BYTES = 64 * 1024

/** Send one JSON response. */
function send(response, status, value) {
  const body = JSON.stringify(value)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  })
  response.end(body)
}

/** Whether the request came from this plugin's own client. */
function authorized(request) {
  return request.headers[HEADER] === '1'
}

/** Read and parse one JSON request body, bounded. */
async function readJson(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) {
      const error = new Error('request body too large')
      error.status = 413
      throw error
    }
    chunks.push(chunk)
  }
  if (size === 0) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    const error = new Error('request body is not valid JSON')
    error.status = 400
    throw error
  }
}

/** Run one page action against the core. */
async function runAction(core, body, { openPath, pickDirectory, signal }) {
  const action = body?.action
  switch (action) {
    case 'refresh':
      return core.refresh({ fetch: body.fetch !== false })
    case 'update':
      return core.update(typeof body.bundle === 'string' ? body.bundle : null)
    case 'sync':
      return core.sync(typeof body.bundle === 'string' ? body.bundle : null, { dryRun: body.dryRun === true })
    case 'switch': {
      if (typeof body.bundle !== 'string' || typeof body.track !== 'string') {
        const error = new Error('switch needs a bundle and a track')
        error.status = 400
        throw error
      }
      return core.switch(body.bundle, body.track)
    }
    case 'revert': {
      if (typeof body.bundle !== 'string') {
        const error = new Error('revert needs a bundle')
        error.status = 400
        throw error
      }
      return core.revert(body.bundle)
    }
    case 'detail': {
      if (typeof body.bundle !== 'string') {
        const error = new Error('detail needs a bundle')
        error.status = 400
        throw error
      }
      return core.detail(body.bundle)
    }
    case 'browse': {
      if (typeof pickDirectory !== 'function') {
        return { ok: false, code: 'browse-unavailable', message: 'this Host cannot open a directory picker' }
      }
      try {
        return await pickDirectory()
      } catch (error) {
        return { ok: false, code: error.code ?? 'browse-failed', message: error.message }
      }
    }
    case 'settings': {
      return core.setSettings(body.patch)
    }
    case 'timeline': {
      return core.timeline()
    }
    case 'hygiene': {
      return core.hygiene({ refresh: body.refresh === true })
    }
    case 'catalog': {
      return core.catalog({ refresh: body.refresh === true, owners: Array.isArray(body.owners) ? body.owners : null })
    }
    case 'catalog-icon': {
      if (typeof body.owner !== 'string' || typeof body.repo !== 'string') {
        const error = new Error('catalog-icon needs an owner and a repository')
        error.status = 400
        throw error
      }
      return core.catalogIcon(body.owner, body.repo)
    }
    case 'catalog-preview': {
      if (typeof body.owner !== 'string' || typeof body.repo !== 'string') {
        const error = new Error('catalog-preview needs an owner and a repository')
        error.status = 400
        throw error
      }
      return core.catalogPreview(body.owner, body.repo)
    }
    case 'install': {
      if (body.door !== 'directory' && body.door !== 'repository') {
        const error = new Error('install needs a door: directory or repository')
        error.status = 400
        throw error
      }
      const spec = typeof body.spec === 'string' ? body.spec : ''
      return body.door === 'repository' ? core.installRepository(spec) : core.installDirectory(spec)
    }
    case 'document': {
      if (typeof body.bundle !== 'string' || typeof body.target !== 'string') {
        const error = new Error('document needs a bundle and a target')
        error.status = 400
        throw error
      }
      return core.readDocument(body.bundle, body.target)
    }
    case 'open': {
      if (typeof body.bundle !== 'string' || typeof body.target !== 'string') {
        const error = new Error('open needs a bundle and a target')
        error.status = 400
        throw error
      }
      const resolved = await core.openTarget(body.bundle, body.target)
      if (!resolved.ok) return resolved
      try {
        await openPath(resolved.path, resolved.target, signal)
      } catch (error) {
        return { ok: false, code: error.code ?? 'open-failed', message: error.message }
      }
      return { ok: true, opened: true, bundle: resolved.name, target: resolved.target }
    }
    case 'tracks': {
      if (typeof body.bundle !== 'string') {
        const error = new Error('tracks needs a bundle')
        error.status = 400
        throw error
      }
      return { ok: true, tracks: await core.tracks(body.bundle) }
    }
    default: {
      const error = new Error(`unknown action: ${String(action)}`)
      error.status = 400
      throw error
    }
  }
}

/**
 * Register the plugin's routes on the Host web server.
 *
 * @param {{ register: Function }} webServer - the Host carrier.
 * @param {{ core: object, ready: Promise<Error | null>, openPath: (path: string, target: string, signal: AbortSignal) => Promise<void>, pickDirectory?: () => Promise<object> }} deps - the core, its load promise, the native opener and the directory picker.
 * @returns {() => void} one disposer removing both routes.
 */
export function registerRoutes(webServer, { core, ready, openPath, pickDirectory }) {
  let clientSeenAt = null
  let clientSeenUserAgent = null

  const noteClient = (request) => {
    if (request.headers[CLIENT_HEADER] !== '1') return
    clientSeenAt = new Date().toISOString()
    clientSeenUserAgent = request.headers['user-agent'] ?? null
  }

  const statusRoute = webServer.register({
    kind: 'exact',
    path: `${PREFIX}/status`,
    async handler(request, response) {
      if (request.method !== 'GET') return send(response, 405, { error: 'method not allowed' })
      if (!authorized(request)) return send(response, 403, { error: 'forbidden' })
      noteClient(request)
      const failure = await ready
      if (failure) return send(response, 500, { error: failure.message })

      const transport = clientSeenAt === null
        ? { clientSeenAt: null, clientSeenUserAgent: null }
        : { clientSeenAt, clientSeenUserAgent }
      send(response, 200, { ...core.snapshot(), transport })
    },
  })

  const actionRoute = webServer.register({
    kind: 'exact',
    path: `${PREFIX}/action`,
    async handler(request, response) {
      if (request.method !== 'POST') return send(response, 405, { error: 'method not allowed' })
      if (!authorized(request)) return send(response, 403, { error: 'forbidden' })
      noteClient(request)

      let body
      try {
        body = await readJson(request)
      } catch (error) {
        return send(response, error.status ?? 400, { ok: false, code: 'bad-request', message: error.message })
      }

      const failure = await ready
      if (failure) return send(response, 500, { ok: false, code: 'not-ready', message: failure.message })

      const controller = new AbortController()
      try {
        const result = await runAction(core, body, { openPath, pickDirectory, signal: controller.signal })
        controller.abort()
        send(response, 200, result)
      } catch (error) {
        controller.abort()
        send(response, error.status ?? 500, { ok: false, code: error.code ?? 'error', message: error.message })
      }
    },
  })

  return () => {
    actionRoute()
    statusRoute()
  }
}
