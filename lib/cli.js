/**
 * The `vib` command on the user's PATH.
 *
 * The page can report whether the user's own shell finds the CLI, link it into
 * npm's global bin with `npm link`, and remove that link again. The two writes
 * happen only after an explicit in-page confirmation: the harness approval
 * service is turn-bound (it needs an open model turn and an agent), so a
 * Settings button cannot route a decision through it.
 *
 * Status is read on demand and never cached — the machine can change outside
 * the GUI (another terminal, an npm install, a Node version switch).
 *
 * @module viburnum/lib/cli
 */

import { spawn as nodeSpawn } from 'node:child_process'
import { realpath as nodeRealpath, stat as nodeStat } from 'node:fs/promises'
import { join } from 'node:path'

/** The global package name `npm link` registers for this checkout. */
export const CLI_PACKAGE = 'dsh-plugin-viburnum'

/** The command names this package declares. */
export const CLI_NAMES = ['vib', 'viburnum']

/** Bound on one shell probe; a login shell may read profile files. */
export const PROBE_TIMEOUT_MS = 15_000

/** Bound on `npm prefix -g`. */
export const PREFIX_TIMEOUT_MS = 20_000

/** Bound on `npm link` or `npm unlink`. */
export const LINK_TIMEOUT_MS = 120_000

/** The npm executable for one platform. */
export function npmCommand(platform = process.platform) {
  return platform === 'win32' ? 'npm.cmd' : 'npm'
}

/** The directory npm puts global bin shims in. */
export function globalBinDir(prefix, platform = process.platform) {
  return platform === 'win32' ? prefix : join(prefix, 'bin')
}

/** The shim files npm may create for this package, one per candidate name. */
export function shimPaths(prefix, platform = process.platform) {
  const dir = globalBinDir(prefix, platform)
  const names = platform === 'win32'
    ? CLI_NAMES.flatMap((name) => [`${name}.cmd`, `${name}.ps1`, name])
    : [...CLI_NAMES]
  return names.map((name) => join(dir, name))
}

/** The npm global prefix from `npm prefix -g` output (its last non-empty line). */
export function parsePrefix(stdout) {
  const lines = String(stdout)
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line !== '')
  return lines.length === 0 ? null : lines[lines.length - 1]
}

/** The first absolute path a shell probe printed, if any. */
export function parseProbe(stdout, platform = process.platform) {
  for (const raw of String(stdout).split(/\r?\n/u)) {
    const line = raw.trim()
    if (line === '') continue
    if (platform === 'win32' ? /^[A-Za-z]:[\\/]/u.test(line) : line.startsWith('/')) return line
  }
  return null
}

/**
 * The probe commands, the user's own shell first.
 *
 * A login shell reads profile files while a GUI-launched Host inherits a much
 * narrower PATH, so the user's `$SHELL` is asked before the safe fallback.
 * Fish, zsh, bash and sh all accept `-ilc`/`-lc` with `command -v`.
 */
export function probeCommands(platform = process.platform, shell = null) {
  if (platform === 'win32') return [{ command: 'where', args: ['vib'] }]
  const commands = []
  if (typeof shell === 'string' && shell !== '') {
    commands.push({ command: shell, args: ['-ilc', 'command -v vib'] })
    commands.push({ command: shell, args: ['-lc', 'command -v vib'] })
  }
  commands.push({ command: '/bin/sh', args: ['-lc', 'command -v vib'] })
  return commands
}

/** The PATH line a user can paste when the bin folder is not on PATH. */
export function pathLine(binDir, platform = process.platform) {
  return platform === 'win32'
    ? `setx PATH "%PATH%;${binDir}"`
    : `export PATH="${binDir}:$PATH"`
}

/** The command that runs the CLI without touching PATH. */
export function directInvocation(checkout) {
  return `node "${join(checkout, 'bin', 'vib.js')}"`
}

/**
 * Run one child process and capture it with a bound.
 *
 * @param {Function} spawnImpl - child_process.spawn or a test double.
 * @param {string} command - executable.
 * @param {string[]} args - arguments.
 * @param {{ cwd: string, env: NodeJS.ProcessEnv, timeoutMs: number }} options - run options.
 * @returns {Promise<{ code: number | null, stdout: string, stderr: string, error: Error | null }>} the result.
 */
function run(spawnImpl, command, args, { cwd, env, timeoutMs }) {
  return new Promise((resolvePromise) => {
    let child
    try {
      child = spawnImpl(command, args, {
        cwd,
        env,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (error) {
      resolvePromise({ code: null, stdout: '', stderr: '', error })
      return
    }

    let stdout = ''
    let stderr = ''
    let settled = false
    const finish = (value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolvePromise(value)
    }

    // The page action awaits this result, so the bound timer stays referenced.
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL')
      } catch {
        // The process is already gone; the result is the timeout either way.
      }
      const error = new Error(`${command} did not answer within ${timeoutMs} ms`)
      error.code = 'timeout'
      finish({ code: null, stdout, stderr, error })
    }, timeoutMs)

    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (chunk) => { stdout += String(chunk) })
    child.stderr?.on('data', (chunk) => { stderr += String(chunk) })
    child.on('error', (error) => finish({ code: null, stdout, stderr, error }))
    child.on('close', (code) => finish({ code, stdout, stderr, error: null }))
  })
}

/**
 * How to start npm on one platform.
 *
 * Windows must go through `cmd.exe`: Node refuses to spawn a `.cmd` shim
 * directly, and cmd expands it safely because the argument tokens are fixed.
 */
function npmSpec(platform, args, env = process.env) {
  if (platform === 'win32') {
    return { command: env.ComSpec ?? 'cmd.exe', args: ['/d', '/s', '/c', npmCommand(platform), ...args] }
  }
  return { command: npmCommand(platform), args }
}

/** The last readable line of a failed npm run. */
function failureMessage(result, fallback) {
  const text = String(result.stderr || result.stdout || '').trim()
  if (text === '') return result.error === null ? fallback : result.error.message
  return text.split(/\r?\n/u).slice(-1)[0]
}

/**
 * Build the CLI helpers for one checkout.
 *
 * @param {{ checkout: string, platform?: NodeJS.Platform, env?: NodeJS.ProcessEnv, spawnImpl?: Function, fsImpl?: { stat: Function, realpath: Function } }} deps - checkout root and test seams.
 * @returns {{ status: Function, install: Function, remove: Function }} the three page actions.
 */
export function createCli({
  checkout,
  platform = process.platform,
  env = process.env,
  spawnImpl = nodeSpawn,
  fsImpl = { stat: nodeStat, realpath: nodeRealpath },
}) {
  /** The npm global prefix, or null when npm is unavailable. */
  async function npmPrefix() {
    const spec = npmSpec(platform, ['prefix', '-g'], env)
    const result = await run(spawnImpl, spec.command, spec.args, {
      cwd: checkout,
      env,
      timeoutMs: PREFIX_TIMEOUT_MS,
    })
    if (result.error !== null || result.code !== 0) return null
    return parsePrefix(result.stdout)
  }

  /** The first shim file npm created, if any. */
  async function existingShim(prefix) {
    for (const candidate of shimPaths(prefix, platform)) {
      try {
        await fsImpl.stat(candidate)
        return candidate
      } catch {
        // Not this name; the next candidate may be the one npm created.
      }
    }
    return null
  }

  /** Whether the global package link resolves into this checkout. */
  async function linkedToCheckout(prefix) {
    try {
      const installed = await fsImpl.realpath(join(prefix, 'node_modules', CLI_PACKAGE))
      const expected = await fsImpl.realpath(checkout)
      const normalize = (value) => String(value).replace(/\\/gu, '/').replace(/\/+$/u, '')
      const left = normalize(installed)
      const right = normalize(expected)
      return platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right
    } catch {
      return false
    }
  }

  /** What the user's own shell resolves, and the shell used for the answer. */
  async function shellProbe() {
    const shell = typeof env.SHELL === 'string' && env.SHELL.trim() !== '' ? env.SHELL.trim() : null
    for (const candidate of probeCommands(platform, shell)) {
      const result = await run(spawnImpl, candidate.command, candidate.args, {
        cwd: checkout,
        env,
        timeoutMs: PROBE_TIMEOUT_MS,
      })
      if (result.error !== null) continue
      const found = parseProbe(result.stdout, platform)
      if (found !== null) return { shell: candidate.command, path: found }
    }
    return { shell, path: null }
  }

  /**
   * The command state on this machine.
   *
   * `available` — the user's shell finds it; `linked` — a shim exists in npm's
   * global bin but the shell does not see it; `missing` — no shim; `unknown` —
   * npm could not be read.
   *
   * @returns {Promise<object>} the state, its paths and the copyable fallbacks.
   */
  async function status() {
    const prefix = await npmPrefix()
    const probe = await shellProbe()
    const binDir = prefix === null ? null : globalBinDir(prefix, platform)
    const shim = prefix === null ? null : await existingShim(prefix)
    const owned = shim === null ? false : await linkedToCheckout(prefix)
    const base = {
      ok: true,
      platform,
      npm: prefix !== null,
      shell: probe.shell,
      direct: directInvocation(checkout),
      path: null,
      binDir,
      shim,
      owned,
      pathLine: null,
      message: null,
    }

    if (probe.path !== null) return { ...base, state: 'available', path: probe.path }
    if (prefix === null) {
      return {
        ...base,
        state: 'unknown',
        message: 'npm is not available, so the command cannot be linked from here.',
      }
    }
    if (shim === null) return { ...base, state: 'missing' }
    return { ...base, state: 'linked', pathLine: pathLine(binDir, platform) }
  }

  /**
   * Link the command into npm's global bin (`npm link` in this checkout).
   *
   * @param {{ confirm?: boolean }} [options] - explicit page confirmation.
   * @returns {Promise<object>} `{ ok, code?, message?, status }` with a fresh status.
   */
  async function install({ confirm = false } = {}) {
    if (confirm !== true) {
      return {
        ok: false,
        code: 'confirmation-required',
        message: 'installing the command needs an explicit confirmation',
        status: await status(),
      }
    }
    const prefix = await npmPrefix()
    if (prefix === null) {
      return {
        ok: false,
        code: 'npm-unavailable',
        message: 'npm is not available in this profile',
        status: await status(),
      }
    }

    const spec = npmSpec(platform, ['link'], env)
    const result = await run(spawnImpl, spec.command, spec.args, {
      cwd: checkout,
      env,
      timeoutMs: LINK_TIMEOUT_MS,
    })
    const after = await status()
    if (result.error !== null || result.code !== 0) {
      return { ok: false, code: 'npm-link-failed', message: failureMessage(result, 'npm link failed'), status: after }
    }
    return { ok: true, status: after }
  }

  /**
   * Remove our own npm link. Never touches a foreign `vib` install.
   *
   * @param {{ confirm?: boolean }} [options] - explicit page confirmation.
   * @returns {Promise<object>} `{ ok, code?, message?, status }` with a fresh status.
   */
  async function remove({ confirm = false } = {}) {
    if (confirm !== true) {
      return {
        ok: false,
        code: 'confirmation-required',
        message: 'removing the command needs an explicit confirmation',
        status: await status(),
      }
    }
    const before = await status()
    if (before.shim === null) {
      return { ok: false, code: 'not-installed', message: 'the vib command is not installed on this machine', status: before }
    }
    if (before.owned !== true) {
      return {
        ok: false,
        code: 'not-ours',
        message: 'the vib command was not linked from this checkout; leaving it alone',
        status: before,
      }
    }

    const unlink = npmSpec(platform, ['unlink', '-g', CLI_PACKAGE], env)
    let result = await run(spawnImpl, unlink.command, unlink.args, {
      cwd: checkout,
      env,
      timeoutMs: LINK_TIMEOUT_MS,
    })
    if (result.error !== null || result.code !== 0) {
      const fallback = npmSpec(platform, ['rm', '-g', CLI_PACKAGE], env)
      const removed = await run(spawnImpl, fallback.command, fallback.args, {
        cwd: checkout,
        env,
        timeoutMs: LINK_TIMEOUT_MS,
      })
      if (removed.error === null && removed.code === 0) result = removed
    }

    const after = await status()
    if (after.shim !== null) {
      return { ok: false, code: 'remove-failed', message: failureMessage(result, 'npm could not remove the link'), status: after }
    }
    return { ok: true, status: after }
  }

  return { status, install, remove }
}
