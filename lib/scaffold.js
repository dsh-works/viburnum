/**
 * `vib new` scaffolding: write a bundle that already satisfies the dsh-works
 * taxonomy — manifest, bundle patch, Host entry, a test and a README.
 *
 * The scaffolder only writes local files. Git is opt-in; publishing, remote
 * creation and installation stay separate commands.
 *
 * @module viburnum/lib/scaffold
 */

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { must } from './git.js'

/** Every bundle package name in the taxonomy starts with this. */
export const PACKAGE_PREFIX = 'dsh-plugin-'

/** Engines fallback when viburnum's own manifest cannot be read. */
const FALLBACK_ENGINE = '^0.2.1-rc.2'

/**
 * Normalize a requested name into the taxonomy's package name and row id.
 *
 * @param {string} input - what the user typed, such as `demo` or `Demo Plugin`.
 * @returns {{ packageName: string, slug: string, title: string }} the identity.
 * @throws when nothing name-shaped is left.
 */
export function pluginIdentity(input) {
  const raw = String(input ?? '').trim().toLowerCase()
  if (raw === '') throw new Error('new needs a plugin name')

  const cleaned = raw
    .replace(/[^a-z0-9-]+/gu, '-')
    .replace(/-+/gu, '-')
    .replace(/^-|-$/gu, '')
  if (cleaned === '') throw new Error(`"${input}" is not a plugin name`)

  const packageName = cleaned.startsWith(PACKAGE_PREFIX) ? cleaned : PACKAGE_PREFIX + cleaned
  const slug = packageName.slice(PACKAGE_PREFIX.length)
  if (!/^[a-z][a-z0-9-]*$/u.test(slug)) {
    throw new Error(`"${input}" is not a plugin name: use lowercase letters, digits and inner hyphens`)
  }
  return { packageName, slug, title: slug.replace(/-/gu, ' ') }
}

/** The manifest a fresh Host-only bundle starts with. */
function manifest(identity, engineRange) {
  return `${JSON.stringify({
    name: identity.packageName,
    version: '0.1.0',
    private: true,
    type: 'module',
    description: `${identity.slug} — a DeepSeek Harness plugin bundle.`,
    main: 'index.js',
    exports: {
      '.': './index.js',
      './cordis.patch.yml': './cordis.patch.yml',
      './package.json': './package.json',
    },
    files: [
      'index.js',
      'cordis.patch.yml',
      'README.md',
      'test/',
    ],
    license: 'MIT',
    engines: {
      node: '>=22',
      dsh: engineRange,
    },
    scripts: {
      test: 'node --test test/*.test.mjs',
    },
    dsh: {
      manifestVersion: 1,
      bundle: {
        patch: './cordis.patch.yml',
      },
    },
  }, null, 2)}\n`
}

/** The bundle patch that mounts the Host entry. */
function patch(identity) {
  return `# The ${identity.packageName} bundle patch.
#
# One insert: the row that mounts the plugin. A profile overlay can override
# the row by id, or disable it:
#
#   - id: ${identity.slug}
#     disabled: true

- insert:
    - id: ${identity.slug}
      name: '${identity.packageName}'
`
}

/** The Host entry: an empty effect a feature fills in. */
function entry(identity) {
  return `/**
 * ${identity.packageName} — ${identity.title}, a DeepSeek Harness plugin bundle.
 *
 * @module ${identity.packageName}
 */

/** Short row id used in diagnostics; must match cordis.patch.yml. */
export const name = '${identity.slug}'

/** Host services this plugin cannot run without. */
export const inject = []

/**
 * Register the plugin's effects. Unloading removes everything registered here.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx - host context.
 */
export function apply(ctx) {
  void ctx
  // Add tools, prompt sections, routes or UI slots here.
}
`
}

/** The bundle test: the manifest and the patch row line up. */
function test(identity) {
  return `/**
 * Scaffold checks for ${identity.packageName}: the manifest and the patch row.
 */

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import { apply, name } from '../index.js'

test('the manifest declares the bundle patch', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(pkg.name, '${identity.packageName}')
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(typeof pkg.engines.dsh, 'string')
})

test('the row id matches the entry name', () => {
  assert.equal(name, '${identity.slug}')
  assert.equal(typeof apply, 'function')
})
`
}

/** The banner README for a fresh bundle. */
function readme(identity) {
  return `# ${identity.packageName}

${identity.slug} — a DeepSeek Harness plugin bundle.

## Use this package

Mount the bundle in a profile with the harness plugin manager, or from a viburnum page:

\`\`\`sh
vib install .
\`\`\`

The row id is \`${identity.slug}\`; disabling it in the profile's \`cordis.patch.yml\` hides the plugin
without uninstalling it.

## Develop

\`\`\`sh
npm test
\`\`\`

\`index.js\` is the Host half. Add the plugin's effects in \`apply\`; keep \`name\` equal to the bundle
patch's row id.
`
}

/** Read viburnum's own DSH engine range so a new bundle tracks the same runtime. */
async function engineRange() {
  try {
    const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
    return typeof pkg?.engines?.dsh === 'string' ? pkg.engines.dsh : FALLBACK_ENGINE
  } catch {
    return FALLBACK_ENGINE
  }
}

/**
 * Scaffold one bundle into a target directory.
 *
 * @param {{ name: string, dir?: string, cwd?: string, git?: boolean }} options - the request.
 * @returns {Promise<{ ok: true, package: string, slug: string, dir: string, files: string[], git: boolean, warning: string | null }>} the result.
 * @throws when the name is invalid or the target is a non-empty directory.
 */
export async function scaffoldPlugin({ name, dir, cwd = process.cwd(), git = false }) {
  const identity = pluginIdentity(name)
  const target = resolve(cwd, dir === undefined ? identity.packageName : dir)
  const range = await engineRange()

  await mkdir(target, { recursive: true })
  const existing = await readdir(target)
  if (existing.length > 0) {
    const error = new Error(`${target} already exists and is not empty`)
    error.code = 'target-exists'
    throw error
  }

  const files = new Map([
    ['package.json', manifest(identity, range)],
    ['cordis.patch.yml', patch(identity)],
    ['index.js', entry(identity)],
    ['README.md', readme(identity)],
    ['test/plugin.test.mjs', test(identity)],
    ['.gitignore', 'node_modules/\n'],
  ])

  for (const [relative, content] of files) {
    const path = join(target, relative)
    await mkdir(resolve(path, '..'), { recursive: true })
    await writeFile(path, content)
  }

  let gitDone = false
  let warning = null
  if (git) {
    try {
      await must(target, ['init'])
      await must(target, ['add', '-A'])
      await must(target, ['commit', '-m', `Scaffold ${identity.packageName}`])
      gitDone = true
    } catch (error) {
      warning = `git was requested but did not finish: ${error.message}`
    }
  }

  return {
    ok: true,
    package: identity.packageName,
    slug: identity.slug,
    dir: target,
    files: [...files.keys()],
    git: gitDone,
    warning,
  }
}
