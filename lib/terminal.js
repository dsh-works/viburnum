/**
 * Open a terminal window already in a checkout directory.
 *
 * The page cannot own a PTY (it is not session-bound), so this uses the Host
 * desktop's own terminal. Commands are fixed per application; the directory is
 * passed as one argument or one escaped AppleScript/PowerShell literal — never
 * a shell string built from user input.
 *
 * @module viburnum/lib/terminal
 */

import { spawn } from 'node:child_process'
import { isAbsolute } from 'node:path'

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

/** Escape one AppleScript double-quoted string. */
function appleScriptString(text) {
  return String(text).replace(/\\/gu, '\\\\').replace(/"/gu, '\\"')
}

/** Escape one POSIX shell word. */
function shellWord(text) {
  return `'${String(text).replace(/'/gu, "'\\''")}'`
}

/** The command for one terminal id. */
function commandFor(id, dir) {
  if (id === 'wt') return { command: 'wt.exe', args: ['-d', dir] }
  if (id === 'powershell') {
    return {
      command: 'powershell.exe',
      args: ['-NoExit', '-Command', `Set-Location -LiteralPath ${powershellLiteral(dir)}`],
    }
  }
  if (id === 'iterm2') {
    return {
      command: 'osascript',
      args: ['-e', `tell application "iTerm2" to create window with default profile command "cd ${appleScriptString(dir)}"`],
    }
  }
  if (id === 'terminal') {
    return {
      command: 'osascript',
      args: ['-e', `tell application "Terminal" to do script "cd ${appleScriptString(dir)}"`],
    }
  }
  if (id === 'x-terminal-emulator') {
    return { command: 'x-terminal-emulator', args: [`--working-directory=${dir}`] }
  }
  if (id === 'gnome-terminal') {
    return { command: 'gnome-terminal', args: [`--working-directory=${dir}`] }
  }
  if (id === 'xterm') {
    return { command: 'xterm', args: ['-e', 'sh', '-c', `cd ${shellWord(dir)} && exec "$SHELL"`] }
  }
  return null
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
  if (typeof dir !== 'string' || !isAbsolute(dir)) throw new Error('a terminal needs an absolute directory')
  const ids = terminalIds(platform).filter((id) => id !== 'auto')
  const order = preferred !== 'auto' && ids.includes(preferred)
    ? [preferred, ...ids.filter((id) => id !== preferred)]
    : ids
  return order.map((id) => commandFor(id, dir)).filter((candidate) => candidate !== null)
}

/** Try one candidate; true when the process was spawned. */
function trySpawn(candidate) {
  return new Promise((resolvePromise) => {
    let child
    try {
      child = spawn(candidate.command, candidate.args, {
        detached: true,
        windowsHide: false,
        stdio: 'ignore',
      })
    } catch {
      resolvePromise(false)
      return
    }
    let settled = false
    child.on('error', () => {
      if (settled) return
      settled = true
      resolvePromise(false)
    })
    child.on('spawn', () => {
      if (settled) return
      settled = true
      child.unref()
      resolvePromise(true)
    })
  })
}

/**
 * Open the desktop terminal at one checkout.
 *
 * @param {string} dir - absolute checkout directory.
 * @param {{ platform?: NodeJS.Platform, preferred?: string }} [options] - platform and settings id.
 * @returns {Promise<{ ok: true } | { ok: false, code: 'terminal-unavailable', message: string }>} the result.
 */
export async function openTerminalAt(dir, { platform = process.platform, preferred = 'auto' } = {}) {
  let list
  try {
    list = terminalCommand(platform, dir, preferred)
  } catch (error) {
    return { ok: false, code: 'terminal-unavailable', message: error.message }
  }
  for (const candidate of list) {
    if (await trySpawn(candidate)) return { ok: true }
  }
  return {
    ok: false,
    code: 'terminal-unavailable',
    message: `no terminal application could be started on ${platform}`,
  }
}
