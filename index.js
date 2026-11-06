/**
 * Host half of the viburnum bundle.
 *
 * Viburnum watches the git checkouts the profile links to and keeps them in
 * sync across two machines. This entry owns the core instance and registers
 * its effects: the model-facing tools, the prompt section, the page transport
 * and the background check timer. Unloading the plugin removes all of them.
 *
 * @module dsh-plugin-viburnum
 */

import { Config } from './lib/config.js'
import { createCore } from './lib/core.js'
import { listMountedBundles } from './lib/profile.js'
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
  const core = createCore({
    bundleSource: ({ env, argv }) => listMountedBundles(ctx.pluginManager, { env, argv }),
    config,
    log,
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

  const webServer = ctx.get('webServer')
  if (webServer !== undefined && webServer !== null) {
    ctx.effect(() => registerRoutes(webServer, { core, ready }), 'dsh-plugin-viburnum: routes')
  }

  const minutes = core.config.checkIntervalMinutes
  if (minutes > 0) {
    // A check on start and on the configured interval. Checks never move code;
    // every move stays a click, a tool call or a CLI command (D9).
    void ready.then((error) => {
      if (error) {
        reportLoadError(error)
        return
      }
      void core.refresh().catch((failure) => log.warn(`dsh-plugin-viburnum: check failed: ${failure.message}`))
    })

    ctx.effect(() => {
      const timer = setInterval(() => {
        void core
          .refresh()
          .catch((failure) => log.warn(`dsh-plugin-viburnum: check failed: ${failure.message}`))
      }, minutes * 60 * 1000)
      return () => clearInterval(timer)
    }, 'dsh-plugin-viburnum: check interval')
  }

  log.info(
    `ready — ${core.config.checkIntervalMinutes > 0 ? `checking every ${core.config.checkIntervalMinutes} min` : 'checks on demand'}`,
  )
}
