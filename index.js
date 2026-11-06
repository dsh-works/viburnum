/**
 * Host half of the viburnum bundle.
 *
 * Viburnum watches the git checkouts the profile links to and keeps them in
 * sync across two machines. The work lives in `lib/`; this entry only mounts
 * the plugin and registers its effects.
 *
 * The tools, the Web page and the CLI arrive in the build order of
 * `docs/PLAN.md`. This file is the shell they attach to: the plugin is safe to
 * mount while it is being built.
 *
 * @module dsh-plugin-viburnum
 */

/** Short id used in diagnostics; must match the patch row id. */
export const name = 'viburnum'

/** Host services this plugin cannot run without. */
export const inject = []

/**
 * Register the plugin's effects. Every registration is owned by `ctx`, so
 * unloading the plugin removes all of them.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx - host context.
 */
export function apply(ctx) {
  void ctx
}
