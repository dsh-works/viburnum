/**
 * Open a terminal window already in a checkout directory.
 *
 * The page cannot own a PTY (it is not session-bound), so this uses the Host
 * desktop's own terminal. The command is fixed per platform and the directory
 * is passed as one argument or one escaped PowerShell literal — never a shell
 * string built from user input.
 *
 * @module viburnum/lib/terminal
 */

import { spawn } from 'node:child_process'
import { isAbsolute } from 'node:path'

/** One terminal launch candidate for a platform. */
function candidates(platform, dir) {
  if (platform === 'win32') {
    const literal = dir.replace(/'/gu, "''")
    return [
      { command: 'wt.exe', args: ['-d', dir] },
      { command: 'powershell.exe', args: ['-NoExit', '-Command', `Set-Location -LiteralPath '${literal}'`] },
    ]
  }
  if (platform === 'darwin') {
    const script = `tell application "Terminal" to do script "cd ${dir.replace(/["\\]/gu, '\\$&')}"`
    return [{ command: 'osascript', args: ['-e', script] }]
  }
  return [
    { command: 'x-terminal-emulator', args: [`--working-directory=${dir}`] },
    { command: 'gnome-terminal', args: [`--working-directory=${dir}`] },
  ]
}

/**
 * Describe the terminal command for one platform (pure, for tests).
 *
 * @param {NodeJS.Platform} platform - platform to describe.
 * @param {string} dir - absolute checkout directory.
 * @returns {Array<{ command: string, args: string[] }>} candidates in order.
 * @throws when the directory is not absolute.
 */
export function terminalCommand(platform, dir) {
  if (typeof dir !== 'string' || !isAbsolute(dir)) throw new Error('a terminal needs an absolute directory')
  return candidates(platform, dir)
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
 * @param {{ platform?: NodeJS.Platform }} [options] - platform override.
 * @returns {Promise<{ ok: true } | { ok: false, code: 'terminal-unavailable', message: string }>} the result.
 */
export async function openTerminalAt(dir, { platform = process.platform } = {}) {
  let list
  try {
    list = terminalCommand(platform, dir)
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
