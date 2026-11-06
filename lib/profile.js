/**
 * Profile discovery shared by the Host half and the CLI.
 *
 * The Host half asks `pluginManager.listBundles()` for mounted bundles; the CLI
 * has no such service, so it reads the profile's `package.json` itself. Both
 * paths normalize each bundle's install spec to the checkout directory with
 * `parseInstallSpec`.
 *
 * @module viburnum/lib/profile
 */

import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join, normalize, resolve } from 'node:path'

/** Profile used when nothing names one. */
export const DEFAULT_PROFILE = 'web'

/**
 * The harness home directory: `$DSH_HOME`, else `~/.dsh`.
 *
 * @param {NodeJS.ProcessEnv} [env] - environment to read.
 * @returns {string} absolute home directory.
 */
export function dshHome(env = process.env) {
  const configured = env.DSH_HOME?.trim()
  return configured ? configured : join(homedir(), '.dsh')
}

/**
 * The profile name: explicit argument, `$DSH_PROFILE`, `--profile <name>` in
 * argv, else `web`.
 *
 * @param {{ explicit?: string, env?: NodeJS.ProcessEnv, argv?: string[] }} [options] - overrides.
 * @returns {string} profile name.
 */
export function profileName({ explicit, env = process.env, argv = process.argv } = {}) {
  if (typeof explicit === 'string' && explicit.trim() !== '') return explicit.trim()

  const fromEnv = env.DSH_PROFILE?.trim()
  if (fromEnv) return fromEnv

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--profile' && typeof argv[index + 1] === 'string' && argv[index + 1].trim() !== '') {
      return argv[index + 1].trim()
    }
    if (argument.startsWith('--profile=')) {
      const value = argument.slice('--profile='.length).trim()
      if (value !== '') return value
    }
  }
  return DEFAULT_PROFILE
}

/**
 * The profile directory.
 *
 * `$DSH_PROFILE_DIR` wins when the launcher exports it; otherwise the path is
 * derived from `$DSH_HOME` and the resolved profile name.
 *
 * @param {{ explicit?: string, env?: NodeJS.ProcessEnv, argv?: string[] }} [options] - overrides.
 * @returns {string} absolute profile directory.
 */
export function resolvedProfileDir(options = {}) {
  const explicit = options.env?.DSH_PROFILE_DIR?.trim()
  if (explicit) return resolve(explicit)
  return join(dshHome(options.env), 'profiles', profileName(options))
}

/**
 * Resolve one install spec to an absolute checkout directory.
 *
 * Only local specs are watched: `link:` and `file:` dependencies. Registry,
 * tarball and git specs belong to the plugin manager, not to this tool.
 *
 * @param {unknown} spec - dependency value such as `link:C:/repos/plugin`.
 * @param {string} baseDir - profile directory for relative specs.
 * @returns {string | null} absolute directory, or null when the spec is not local.
 */
export function parseInstallSpec(spec, baseDir) {
  if (typeof spec !== 'string') return null
  const text = spec.trim()
  if (text === '') return null

  let path = null
  if (text.startsWith('link:')) path = text.slice('link:'.length)
  else if (text.startsWith('file:')) path = text.slice('file:'.length)
  if (path === null) return null

  const clean = path.trim()
  if (clean === '') return null
  return isAbsolute(clean) ? normalize(clean) : resolve(baseDir, clean)
}

/**
 * Read the mounted bundles of a profile without the harness.
 *
 * Only dependencies that are both declared and selected belong to the profile;
 * a dependency the profile does not run is not watched.
 *
 * @param {{ explicit?: string, env?: NodeJS.ProcessEnv, argv?: string[] }} [options] - overrides.
 * @returns {Promise<{ profileDir: string, bundles: Array<{ name: string, dir: string, spec: string }> }>} the profile's linked bundles.
 * @throws when the profile has no readable `package.json`.
 */
export async function readProfileBundles(options = {}) {
  const profileDir = resolvedProfileDir(options)
  const pkg = JSON.parse(await readFile(join(profileDir, 'package.json'), 'utf8'))

  const dependencies = pkg?.dependencies !== null && typeof pkg?.dependencies === 'object' ? pkg.dependencies : {}
  const selected = Array.isArray(pkg?.dsh?.profile?.bundles) ? pkg.dsh.profile.bundles : []
  const bundles = []
  for (const name of selected) {
    if (typeof name !== 'string') continue
    const spec = dependencies[name]
    const dir = parseInstallSpec(spec, profileDir)
    if (dir === null) continue
    bundles.push({ name, dir, spec })
  }
  bundles.sort((left, right) => left.name.localeCompare(right.name))
  return { profileDir, bundles }
}

/**
 * Read the mounted bundles from the Host plugin manager.
 *
 * @param {{ listBundles: () => Promise<Array<object>> }} pluginManager - the Host service.
 * @param {{ explicit?: string, env?: NodeJS.ProcessEnv, argv?: string[] }} [options] - overrides.
 * @returns {Promise<{ profileDir: string, bundles: Array<{ name: string, dir: string, spec: string, version: string | null, enabled: boolean }> }>} linked bundles.
 */
export async function listMountedBundles(pluginManager, options = {}) {
  const profileDir = resolvedProfileDir(options)
  const listed = await pluginManager.listBundles()

  const bundles = []
  const seen = new Set()
  for (const bundle of listed) {
    if (bundle === null || typeof bundle !== 'object' || bundle.installed !== true) continue
    if (typeof bundle.name !== 'string' || seen.has(bundle.name)) continue
    const dir = parseInstallSpec(bundle.source, profileDir)
    if (dir === null) continue
    seen.add(bundle.name)
    bundles.push({
      name: bundle.name,
      dir,
      spec: bundle.source,
      version: typeof bundle.version === 'string' ? bundle.version : null,
      enabled: bundle.enabled !== false,
    })
  }
  bundles.sort((left, right) => left.name.localeCompare(right.name))
  return { profileDir, bundles }
}
