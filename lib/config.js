/**
 * The row's configuration: values two deployments would set differently.
 *
 * Everything here is optional in the profile patch; defaults apply when a key
 * is absent. Invalid values fail the plugin load with an actionable message
 * rather than being repaired silently.
 *
 * @module viburnum/lib/config
 */

/** Defaults; the README documents every field. */
export const DEFAULTS = {
  catalogOwners: ['dsh-works'],
  pluginsDir: '',
  checkIntervalMinutes: 5,
  fetchTimeoutMs: 20_000,
}

/** GitHub owner names: letters, digits and inner hyphens. */
const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/u

/** Inclusive bounds for the numeric fields. */
const RANGES = {
  checkIntervalMinutes: [0, 1440],
  fetchTimeoutMs: [1_000, 120_000],
}

/** One rejection message naming the plugin, the field and what is accepted. */
function reject(field, problem) {
  return new Error(`dsh-plugin-viburnum: config.${field} ${problem}`)
}

/**
 * Normalize the catalog owner list: GitHub owners are case-insensitive, so
 * duplicates collapse and order is preserved.
 *
 * @param {unknown} value - raw configured value.
 * @returns {string[]} owner names.
 * @throws naming the field and the accepted shape.
 */
function owners(value) {
  if (!Array.isArray(value)) throw reject('catalogOwners', 'must be an array of GitHub owner names')
  const seen = new Set()
  const result = []
  for (const entry of value) {
    if (typeof entry !== 'string' || entry.trim() === '') {
      throw reject('catalogOwners', 'must contain non-empty owner names')
    }
    const name = entry.trim()
    if (!OWNER.test(name)) throw reject('catalogOwners', `"${name}" is not a GitHub owner name`)
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push(name)
  }
  return result
}

/**
 * Resolve the row's configuration over the defaults.
 *
 * @param {unknown} input - raw Loader configuration.
 * @returns {{ catalogOwners: string[], pluginsDir: string, checkIntervalMinutes: number, fetchTimeoutMs: number }} resolved configuration.
 * @throws naming the field and what is accepted.
 */
export function resolveConfig(input) {
  const raw = input !== null && typeof input === 'object' && !Array.isArray(input) ? input : {}

  const catalogOwners = raw.catalogOwners === undefined ? [...DEFAULTS.catalogOwners] : owners(raw.catalogOwners)

  const pluginsDir = raw.pluginsDir === undefined ? DEFAULTS.pluginsDir : raw.pluginsDir
  if (typeof pluginsDir !== 'string') throw reject('pluginsDir', 'must be a path string')

  const resolved = { catalogOwners, pluginsDir: pluginsDir.trim() }
  for (const [field, [low, high]] of Object.entries(RANGES)) {
    const value = raw[field] === undefined ? DEFAULTS[field] : raw[field]
    if (!Number.isInteger(value) || value < low || value > high) {
      throw reject(field, `must be an integer between ${low} and ${high}`)
    }
    resolved[field] = value
  }
  return resolved
}

/**
 * The Standard Schema face the Loader validates a row's config with.
 *
 * Unknown keys pass through: the row's options object also carries its id and
 * package name, which are not this plugin's configuration.
 */
export const Config = {
  '~standard': {
    version: 1,
    vendor: 'dsh-plugin-viburnum',
    /**
     * Validate one row's raw configuration.
     *
     * @param {unknown} value - raw configuration.
     * @returns {{ value: Record<string, unknown> } | { issues: Array<{ message: string }> }} the validated value or the problems.
     */
    validate(value) {
      try {
        resolveConfig(value)
      } catch (error) {
        return { issues: [{ message: error.message }] }
      }
      return { value: { ...(value ?? {}) } }
    },
  },
}
