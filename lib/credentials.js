/**
 * Read the GitHub credentials git already stores for this machine.
 *
 * The organisation catalog asks for private repositories too, which needs an
 * authenticated GitHub API call. Rather than keeping a second token somewhere,
 * viburnum asks git's own credential helper — the same store `git push` uses —
 * and keeps the answer in memory only, never in state or logs.
 *
 * @module viburnum/lib/credentials
 */

import { spawn } from 'node:child_process'

/** Bound on one credential-helper call. */
export const CREDENTIAL_TIMEOUT_MS = 8_000

/**
 * Parse a `git credential fill` answer.
 *
 * @param {string} output - the helper's stdout.
 * @returns {{ username: string | null, password: string | null }} the fields found.
 */
export function parseCredentialOutput(output) {
  const fields = {}
  for (const line of String(output ?? '').split(/\r?\n/u)) {
    const separator = line.indexOf('=')
    if (separator <= 0) continue
    const key = line.slice(0, separator).trim()
    const value = line.slice(separator + 1).trim()
    if (key !== '' && value !== '') fields[key] = value
  }
  return {
    username: fields.username ?? null,
    password: fields.password ?? null,
  }
}

/**
 * Ask git's credential helper for the GitHub credentials.
 *
 * @param {{ host?: string, timeoutMs?: number }} [options] - overrides.
 * @returns {Promise<{ username: string | null, token: string | null }>} the credentials, or nulls.
 */
export function readGitCredentials({ host = 'github.com', timeoutMs = CREDENTIAL_TIMEOUT_MS } = {}) {
  return new Promise((resolvePromise) => {
    let child
    try {
      child = spawn('git', ['credential', 'fill'], {
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: '0',
          GIT_ASKPASS: '',
        },
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'ignore'],
      })
    } catch {
      resolvePromise({ username: null, token: null })
      return
    }

    let stdout = ''
    let settled = false
    let timer

    const finish = () => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      child.kill()
      const parsed = parseCredentialOutput(stdout)
      resolvePromise({ username: parsed.username, token: parsed.password })
    }

    timer = setTimeout(finish, timeoutMs)
    timer.unref?.()

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => { stdout += String(chunk) })
    child.on('error', finish)
    child.on('close', finish)

    child.stdin.end(`protocol=https\nhost=${host}\n\n`)
  })
}
