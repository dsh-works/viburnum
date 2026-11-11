/**
 * Offline git fixture repositories: one bare origin and two working clones.
 *
 * The fixture is the test world the design asks for: a `laptop` clone and a
 * `work` clone of the same bare `origin`, with helpers to commit, push, fetch
 * and diverge. No network, no user git configuration, no pnpm.
 *
 * Every world is created under the operating system's temporary directory and
 * is removed by the test that owns it.
 */

import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { GIT_TEST_IDENTITY } from './env.mjs'

/** Fixed identity and config, so tests do not depend on the machine's git setup. */
const FIXED_ENV = {
  ...process.env,
  GIT_TERMINAL_PROMPT: '0',
  GIT_OPTIONAL_LOCKS: '0',
  ...GIT_TEST_IDENTITY,
  LC_ALL: 'C',
}

/**
 * Run git in a directory and throw when it fails.
 *
 * @param {string} cwd - directory to run in.
 * @param {string[]} args - git arguments.
 * @returns {Promise<string>} trimmed stdout.
 */
export function run(cwd, args) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn('git', args, {
      cwd,
      env: FIXED_ENV,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('error', rejectPromise)
    child.on('close', (code) => {
      if (code === 0) {
        resolvePromise(stdout.trim())
        return
      }
      rejectPromise(new Error(`git ${args.join(' ')} failed (${code}): ${stderr.trim() || stdout.trim()}`))
    })
  })
}

/**
 * Create a bare origin with a `laptop` clone and a `work` clone holding the
 * same initial commit. The world is removed when the test ends.
 *
 * @param {import('node:test').TestContext} t - the owning test, for cleanup.
 * @returns {Promise<object>} the world and its helpers.
 */
export async function makeWorld(t) {
  const root = await mkdtemp(join(tmpdir(), 'viburnum-fixture-'))
  t.after(() => rm(root, { recursive: true, force: true }))

  const origin = join(root, 'origin.git')
  const laptop = join(root, 'laptop')
  const work = join(root, 'work')

  await run(root, ['init', '--bare', '--initial-branch=main', origin])
  await run(root, ['init', '--initial-branch=main', laptop])
  await run(laptop, ['config', 'core.autocrlf', 'false'])
  await run(laptop, ['remote', 'add', 'origin', origin])
  await writeFile(join(laptop, 'README.md'), '# fixture\n\nline one\nline two\n')
  await run(laptop, ['add', '--', 'README.md'])
  await run(laptop, ['commit', '-m', 'initial'])
  await run(laptop, ['push', '-u', 'origin', 'main'])

  await run(root, ['clone', origin, work])
  await run(work, ['config', 'core.autocrlf', 'false'])

  const world = {
    root,
    origin,
    laptop,
    work,

    /** Write a file without touching git. */
    write: (dir, file, content) => writeFile(join(dir, file), content),

    /** Write, add and commit one file. */
    async commit(dir, file, content, message = 'update') {
      await writeFile(join(dir, file), content)
      await run(dir, ['add', '--', file])
      await run(dir, ['commit', '-m', message])
    },

    /** Push HEAD to a branch on origin. */
    push: (dir, branch = 'main') => run(dir, ['push', 'origin', `HEAD:${branch}`]),

    /** Fetch and prune from origin. */
    fetch: (dir) => run(dir, ['fetch', '--prune', '--tags', 'origin']),

    /** Fetch, then fast-forward a branch. */
    async pull(dir, branch = 'main') {
      await run(dir, ['fetch', 'origin'])
      await run(dir, ['merge', '--ff-only', `origin/${branch}`])
    },

    /** The current commit id. */
    head: (dir) => run(dir, ['rev-parse', 'HEAD']),

    /** The current branch name. */
    branch: (dir) => run(dir, ['rev-parse', '--abbrev-ref', 'HEAD']),
  }

  return world
}
