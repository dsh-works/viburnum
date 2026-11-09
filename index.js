/**
 * Host half of the viburnum bundle.
 *
 * viburnum watches the git checkouts the profile links to and keeps them in
 * sync across two machines. This entry owns the core instance and registers
 * its effects: the model-facing tools, the prompt section, the page transport
 * and the background check timer. Unloading the plugin removes all of them.
 *
 * @module dsh-plugin-viburnum
 */

import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

import { Config } from './lib/config.js'
import { createCore } from './lib/core.js'
import { fetchOwnerRepos, fetchRepoIcon, fetchRepoPreview } from './lib/catalog.js'
import { readGitCredentials } from './lib/credentials.js'
import { must } from './lib/git.js'
import { scanHygiene } from './lib/hygiene.js'
import { pickDirectory } from './lib/picker.js'
import { listMountedBundles } from './lib/profile.js'
import { openTerminalAt } from './lib/terminal.js'
import { PROMPT } from './lib/prompt.js'
import { buildTools } from './lib/tools.js'
import { registerRoutes } from './lib/web.js'

export { Config }

/** Short id used in diagnostics; must match the patch row id. */
export const name = 'viburnum'

/** Host services this plugin cannot run without. */
export const inject = ['tools', 'systemPrompt', 'pluginManager']

/**
 * Register the plugin's effects.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx - host context.
 * @param {object} config - raw Loader configuration, validated by `Config`.
 */
export function apply(ctx, config) {
  const log = ctx.logger('dsh-plugin-viburnum')
  const directoryService = ctx.get('workingDirectory')
  const workspaceDirectory = typeof directoryService?.defaultDirectory === 'string'
    ? directoryService.defaultDirectory
    : process.cwd()
  let gitHubToken = null

  /** The token for GitHub reads: environment first, then git's stored credentials. */
  const tokenOf = async () => {
    const fromEnv = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? null
    if (fromEnv !== null && fromEnv.trim() !== '') return fromEnv.trim()
    if (gitHubToken === null) gitHubToken = await readGitCredentials()
    return gitHubToken.token
  }

  let core
  core = createCore({
    bundleSource: ({ env, argv }) => listMountedBundles(ctx.pluginManager, { env, argv }),
    config,
    log,
    installer: (spec) => ctx.pluginManager.installBundle(spec),
    inspector: (spec) => ctx.pluginManager.inspect(spec),
    cloner: async (url, target) => {
      await mkdir(dirname(target), { recursive: true })
      await must(dirname(target), ['clone', '--', url, target], { timeoutMs: 120_000 })
    },
    catalogFetcher: async (owner) => fetchOwnerRepos(owner, { token: await tokenOf() }),
    repoIconFetcher: async (owner, repo) => fetchRepoIcon(owner, repo, { token: await tokenOf() }),
    repoPreviewFetcher: async (owner, repo) => fetchRepoPreview(owner, repo, { token: await tokenOf() }),
    hygieneScanner: () => scanHygiene({ roots: [workspaceDirectory, core.shelfDirectory] }),
  })

  /** The state load, as `null` or the error; every consumer awaits it. */
  const ready = core.load().then(
    () => null,
    (error) => error,
  )

  const reportLoadError = (error) => {
    if (error) log.warn(`dsh-plugin-viburnum: state load failed: ${error.message}`)
  }

  for (const tool of buildTools({ ctx, core, ready })) {
    ctx.effect(() => ctx.tools.register(tool), `dsh-plugin-viburnum: ${tool.name}`)
  }

  ctx.effect(
    () => ctx.systemPrompt.section({
      name: 'tool:viburnum',
      order: 4500,
      text: PROMPT,
      interpolate: false,
    }),
    'dsh-plugin-viburnum: prompt section',
  )

  // Web profiles carry a browser server; CLI/headless ones do not. Profile
  // entries are composed concurrently, so a one-shot `ctx.get('webServer')`
  // can run before the carrier is provided — then the page transport is never
  // registered and the browser half reports "The Host did not answer."
  // `ctx.inject` waits for the service and re-runs when it changes.
  ctx.inject(['webServer'], (webCtx) => {
    // The desktop opener is the session controller's verified path opener. It
    // is read at use time because the API domain may activate after this row.
    const openPath = async (path, target, signal) => {
      void target
      const sessionController = webCtx.get('sessionController')
      const unavailable = (message) => {
        const error = new Error(message)
        error.code = 'open-unavailable'
        return error
      }
      if (sessionController === undefined || sessionController === null
        || typeof sessionController.openWorkspacePath !== 'function') {
        throw unavailable('desktop opening is not available in this profile')
      }
      if (typeof sessionController.canOpenWorkspacePath === 'function'
        && !sessionController.canOpenWorkspacePath()) {
        throw unavailable('desktop opening is not available on this host')
      }
      await sessionController.openWorkspacePath({ path }, signal)
    }
    webCtx.effect(
      () => registerRoutes(webCtx.webServer, {
        core,
        ready,
        openPath,
        pickDirectory,
        openTerminal: (dir) => openTerminalAt(dir, { preferred: core.snapshot().settings.terminal }),
      }),
      'dsh-plugin-viburnum: routes',
    )
  })

  // One effect owns the whole check schedule: a startup check when the saved
  // setting allows it, then a one-minute tick that refreshes when the saved
  // interval is due. Checks never move code; every move stays a click, a tool
  // call or a CLI command (D9). Changing the settings takes effect here.
  ctx.effect(() => {
    let disposed = false
    let lastCheck = 0

    const runCheck = () => {
      lastCheck = Date.now()
      void core.refresh().catch((failure) => log.warn(`dsh-plugin-viburnum: check failed: ${failure.message}`))
    }

    void ready.then((error) => {
      if (disposed) return
      if (error) {
        reportLoadError(error)
        return
      }
      if (core.snapshot().settings.refreshOnStartup === true) runCheck()
    })

    const timer = setInterval(() => {
      if (disposed) return
      const minutes = core.snapshot().settings.checkIntervalMinutes
      if (!Number.isInteger(minutes) || minutes <= 0) return
      if (Date.now() - lastCheck < minutes * 60 * 1000) return
      runCheck()
    }, 60_000)
    timer.unref?.()

    return () => {
      disposed = true
      clearInterval(timer)
    }
  }, 'dsh-plugin-viburnum: checks')

  log.info(
    `ready — ${core.config.checkIntervalMinutes > 0 ? `checking every ${core.config.checkIntervalMinutes} min` : 'checks on demand'}`,
  )
}
