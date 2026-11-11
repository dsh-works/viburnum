/**
 * Open a terminal window already in a checkout directory.
 *
 * The page cannot own a PTY (it is not session-bound), so this uses the Host
 * desktop's own terminal. Commands are fixed per application; the directory is
 * passed as one argument or one escaped PowerShell literal — never a shell
 * string built from user input.
 *
 * macOS uses LaunchServices (`open -a <app> <dir>`) rather than AppleScript:
 * `open` needs no automation permission and no scripting API, and it does not
 * create the short-lived session an AppleScript `command` does.
 *
 * @module viburnum/lib/terminal
 */

import { spawn } from 'node:child_process'
import { posix, win32 } from 'node:path'

/** How long a launcher may run before the launch counts as a success. */
export const SPAWN_GRACE_MS = 1_500

/** The terminals a Host can choose from, with the ids the settings store. */
export const TERMINALS = {
  win32: [
    { id: 'auto', label: 'Automatic' },
    { id: 'wt', label: 'Windows Terminal' },
    { id: 'powershell', label: 'PowerShell' },
  ],
  darwin: [
    { id: 'auto', label: 'Automatic' },
    { id: 'iterm2', label: 'iTerm2' },
    { id: 'terminal', label: 'Terminal.app' },
  ],
  linux: [
    { id: 'auto', label: 'Automatic' },
    { id: 'x-terminal-emulator', label: 'x-terminal-emulator' },
    { id: 'gnome-terminal', label: 'GNOME Terminal' },
    { id: 'xterm', label: 'xterm' },
  ],
}

/** The settings ids valid for one platform (including `auto`). */
export function terminalIds(platform = process.platform) {
  return (TERMINALS[platform] ?? TERMINALS.linux).map((entry) => entry.id)
}

/** The labelled choices for the settings page. */
export function terminalChoices(platform = process.platform) {
  return TERMINALS[platform] ?? TERMINALS.linux
}

/** Escape one PowerShell single-quoted literal. */
function powershellLiteral(text) {
  return `'${String(text).replace(/'/gu, "''")}'`
}

/** Escape one POSIX shell word. */
function shellWord(text) {
  return `'${String(text).replace(/'/gu, "'\\''")}'`
}

/**
 * The candidate commands for one terminal id, preferred first.
 *
 * iTerm2 renamed its bundle to `iTerm.app` (while the AppleScript name and the
 * product name stayed iTerm2), so both LaunchServices names are tried; a name
 * that is not installed makes `open` exit non-zero and the next candidate runs.
 */
function commandsFor(id, dir) {
  if (id === 'wt') return [{ command: 'wt.exe', args: ['-d', dir] }]
  if (id === 'powershell') {
    return [{
      command: 'powershell.exe',
      args: ['-NoExit', '-Command', `Set-Location -LiteralPath ${powershellLiteral(dir)}`],
    }]
  }
  if (id === 'iterm2') {
    return [
      { command: 'open', args: ['-a', 'iTerm', dir] },
      { command: 'open', args: ['-a', 'iTerm2', dir] },
    ]
  }
  if (id === 'terminal') return [{ command: 'open', args: ['-a', 'Terminal', dir] }]
  if (id === 'x-terminal-emulator') {
    return [{ command: 'x-terminal-emulator', args: [`--working-directory=${dir}`] }]
  }
  if (id === 'gnome-terminal') {
    return [{ command: 'gnome-terminal', args: [`--working-directory=${dir}`] }]
  }
  if (id === 'xterm') {
    return [{ command: 'xterm', args: ['-e', 'sh', '-c', `cd ${shellWord(dir)} && exec "\${SHELL:-/bin/sh}"`] }]
  }
  return []
}

/**
 * Describe the terminal command candidates for one platform, preferred first.
 *
 * @param {NodeJS.Platform} platform - platform to describe.
 * @param {string} dir - absolute checkout directory.
 * @param {string} [preferred] - settings id (`auto` uses the platform order).
 * @returns {Array<{ command: string, args: string[] }>} candidates in order.
 * @throws when the directory is not absolute.
 */
export function terminalCommand(platform, dir, preferred = 'auto') {
  // Validate against the target platform's path flavour, not the running
  // Host's: the settings page and the tests describe every platform from any
  // Host, and a Windows path is absolute only under win32 rules (and vice
  // versa). The runtime value is already the Host's native absolute path.
  const flavor = platform === 'win32' ? win32 : posix
  if (typeof dir !== 'string' || !flavor.isAbsolute(dir)) throw new Error('a terminal needs an absolute directory')
  const ids = terminalIds(platform).filter((id) => id !== 'auto')
  const order = preferred !== 'auto' && ids.includes(preferred)
    ? [preferred, ...ids.filter((id) => id !== preferred)]
    : ids
  return order.flatMap((id) => commandsFor(id, dir))
}

/**
 * Try one terminal candidate.
 *
 * A terminal window is expected to keep running, so "still running after a
 * short grace period" counts as launched; a process that exits first counts
 * only on exit code 0. A quick non-zero exit — a missing application, refused
 * automation, or no display — is a failure and lets the next candidate run.
 * `spawnImpl` and `graceMs` are test seams.
 *
 * @param {{ command: string, args: string[] }} candidate - command to spawn.
 * @param {{ spawnImpl?: typeof spawn, graceMs?: number }} [options] - test seams.
 * @returns {Promise<boolean>} true when this candidate launched a terminal.
 */
export function trySpawn(candidate, { spawnImpl = spawn, graceMs = SPAWN_GRACE_MS } = {}) {
  return new Promise((resolvePromise) => {
    let child
    try {
      child = spawnImpl(candidate.command, candidate.args, {
        detached: true,
        windowsHide: false,
        stdio: 'ignore',
      })
    } catch {
      resolvePromise(false)
      return
    }

    let settled = false
    let timer
    const finish = (value) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      if (value) child.unref?.()
      resolvePromise(value)
    }

    child.once('error', () => finish(false))
    child.once('close', (code) => finish(code === 0))
    // Do not unref this timer: the caller awaits the outcome, and a timer that
    // does not keep the event loop alive can be dropped before it fires (a
    // short-lived CLI process would otherwise lose the launch result).
    timer = setTimeout(() => finish(true), graceMs)
  })
}

/**
 * Open the desktop terminal at one checkout.
 *
 * @param {string} dir - absolute checkout directory.
 * @param {{ platform?: NodeJS.Platform, preferred?: string, spawnImpl?: typeof spawn, graceMs?: number }} [options] - platform, settings id and test seams.
 * @returns {Promise<{ ok: true } | { ok: false, code: 'terminal-unavailable', message: string }>} the result.
 */
export async function openTerminalAt(dir, {
  platform = process.platform,
  preferred = 'auto',
  spawnImpl = spawn,
  graceMs = SPAWN_GRACE_MS,
} = {}) {
  let list
  try {
    list = terminalCommand(platform, dir, preferred)
  } catch (error) {
    return { ok: false, code: 'terminal-unavailable', message: error.message }
  }
  for (const candidate of list) {
    if (await trySpawn(candidate, { spawnImpl, graceMs })) return { ok: true }
  }
  return {
    ok: false,
    code: 'terminal-unavailable',
    message: `no terminal application could be started on ${platform}`,
  }
}
