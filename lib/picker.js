/**
 * The native directory picker behind the install form's Browse button.
 *
 * The Browser cannot hand a Host an absolute path (a directory input exposes
 * only relative names), so the Host opens its own native dialog and returns the
 * chosen directory. Only the plain path crosses the page route; the dialog
 * itself runs outside the browser.
 *
 * @module viburnum/lib/picker
 */

import { spawn } from 'node:child_process'
import { isAbsolute } from 'node:path'

/** How long a picker may stay open before the call gives up. */
export const PICKER_TIMEOUT_MS = 180_000

/** One typed picker failure with a code the page can word. */
function pickerError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

/**
 * The platform command that opens a directory dialog.
 *
 * @param {NodeJS.Platform} [platform] - platform to describe, defaulting to this one.
 * @returns {{ command: string, args: string[], cancelledExit: number }} the command.
 */
export function pickerCommand(platform = process.platform) {
  if (platform === 'win32') {
    const script = [
      'Add-Type -AssemblyName System.Windows.Forms',
      '$dialog = New-Object System.Windows.Forms.FolderBrowserDialog',
      "$dialog.Description = 'Select a plugin checkout'",
      '$dialog.ShowNewFolderButton = $true',
      '$result = $dialog.ShowDialog()',
      "if ($result -eq 'OK') { [Console]::Out.Write($dialog.SelectedPath) } else { exit 2 }",
    ].join('; ')
    return {
      command: 'powershell.exe',
      args: ['-NoProfile', '-STA', '-WindowStyle', 'Hidden', '-Command', script],
      cancelledExit: 2,
    }
  }
  if (platform === 'darwin') {
    return {
      command: 'osascript',
      args: ['-e', 'POSIX path of (choose folder with prompt "Select a plugin checkout")'],
      cancelledExit: 1,
    }
  }
  return {
    command: 'zenity',
    args: ['--file-selection', '--directory', '--title=Select a plugin checkout'],
    cancelledExit: 1,
  }
}

/**
 * The picker commands to try for one platform, primary first.
 *
 * Linux desktops ship either `zenity` (GNOME) or `kdialog` (KDE); whichever is
 * installed answers, and a missing first command falls through to the next.
 *
 * @param {NodeJS.Platform} [platform] - platform to describe, defaulting to this one.
 * @returns {Array<{ command: string, args: string[], cancelledExit: number }>} candidates in order.
 */
export function pickerCandidates(platform = process.platform) {
  if (platform === 'win32' || platform === 'darwin') return [pickerCommand(platform)]
  return [
    pickerCommand(platform),
    { command: 'kdialog', args: ['--getexistingdirectory', '.'], cancelledExit: 1 },
  ]
}

/**
 * Read the first absolute path a picker printed, if any.
 *
 * @param {string} output - captured stdout.
 * @returns {string | null} the chosen path, or null.
 */
export function pickedPath(output) {
  const lines = String(output)
    .split(/\r?\n/u)
    .map((entry) => entry.trim())
  const line = lines.find((entry) => entry !== '' && isAbsolute(entry))
  return line === undefined ? null : line
}

/**
 * Run one picker command and wait for the choice.
 *
 * @param {{ command: string, args: string[], cancelledExit: number }} spec - the picker command.
 * @param {number} timeoutMs - how long the dialog may stay open.
 * @returns {Promise<{ ok: true, path: string } | { ok: false, code: 'cancelled', message: string }>} the choice.
 */
function runPicker(spec, timeoutMs) {
  return new Promise((resolve, reject) => {
    let child
    try {
      child = spawn(spec.command, spec.args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (error) {
      reject(pickerError('browse-unavailable', error.message))
      return
    }

    let stdout = ''
    let stderr = ''
    let settled = false
    let timer

    const cleanup = () => {
      if (timer) clearTimeout(timer)
    }
    const fail = (code, message) => {
      if (settled) return
      settled = true
      cleanup()
      reject(pickerError(code, message))
    }
    const done = (value) => {
      if (settled) return
      settled = true
      cleanup()
      resolve(value)
    }

    timer = setTimeout(() => {
      child.kill()
      fail('browse-timeout', 'the directory picker stayed open too long')
    }, timeoutMs)
    timer.unref?.()

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => { stdout += String(chunk) })
    child.stderr.on('data', (chunk) => { stderr += String(chunk) })

    child.on('error', (error) => {
      fail(error.code === 'ENOENT' ? 'browse-unavailable' : 'browse-failed', error.message)
    })
    child.on('close', (code) => {
      if (code === spec.cancelledExit) {
        done({ ok: false, code: 'cancelled', message: 'no directory selected' })
        return
      }
      const path = pickedPath(stdout)
      if (path === null) {
        fail('browse-unavailable', stderr.trim() || 'the directory picker returned no path')
        return
      }
      done({ ok: true, path })
    })
  })
}

/**
 * Open the Host's native directory dialog and wait for the choice.
 *
 * @param {{ platform?: NodeJS.Platform, timeoutMs?: number }} [options] - overrides.
 * @returns {Promise<{ ok: true, path: string } | { ok: false, code: 'cancelled', message: string }>} the choice.
 * @throws a coded error when no picker exists, the user chose nothing, or the dialog failed.
 */
export async function pickDirectory({ platform = process.platform, timeoutMs = PICKER_TIMEOUT_MS } = {}) {
  let lastError = pickerError('browse-unavailable', `no directory picker is available on ${platform}`)
  for (const spec of pickerCandidates(platform)) {
    try {
      return await runPicker(spec, timeoutMs)
    } catch (error) {
      // Only an absent command justifies the next candidate; a cancelled or
      // failed dialog is the answer and must reach the page as such.
      if (error.code !== 'browse-unavailable') throw error
      lastError = error
    }
  }
  throw lastError
}
