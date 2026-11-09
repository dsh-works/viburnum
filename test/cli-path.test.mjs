/**
 * CLI-on-PATH checks: detection per platform, ownership, install and remove.
 *
 * Every child process and filesystem touch is injected here; no npm runs, no
 * shell opens and no files are touched.
 */

import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { join, posix } from 'node:path'
import { test } from 'node:test'

import {
  CLI_PACKAGE,
  createCli,
  directInvocation,
  globalBinDir,
  parsePrefix,
  parseProbe,
  pathLine,
  probeCommands,
  shimPaths,
} from '../lib/cli.js'

const CHECKOUT = '/work/viburnum'
const POSIX_PREFIX = '/home/u/.nvm/versions/node/v24'
const WIN_PREFIX = 'C:\\Users\\u\\AppData\\Roaming\\npm'

/** The fake of one child process: stdout/stderr event emitters and a close. */
function fakeChild() {
  const child = new EventEmitter()
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.stdout.setEncoding = () => {}
  child.stderr.setEncoding = () => {}
  child.kill = () => {}
  return child
}

/**
 * A spawn double from a `"command arg arg" -> result` map (an exact key first,
 * then any key prefix). A missing rule is a spawn failure (ENOENT).
 */
function spawnRules(rules) {
  const calls = []
  const spawnImpl = (command, args) => {
    calls.push({ command, args: [...args] })
    const key = [command, ...args].join(' ')
    const child = fakeChild()
    queueMicrotask(() => {
      const entry = Object.entries(rules).find(([prefix]) => key === prefix)
        ?? Object.entries(rules).find(([prefix]) => key.startsWith(prefix))
      if (entry === undefined) {
        const error = new Error(`spawn ${command} ENOENT`)
        error.code = 'ENOENT'
        child.emit('error', error)
        return
      }
      const result = typeof entry[1] === 'function' ? entry[1](key) : entry[1]
      if (result.error !== undefined) {
        child.emit('error', result.error)
        return
      }
      if (result.stdout) child.stdout.emit('data', result.stdout)
      if (result.stderr) child.stderr.emit('data', result.stderr)
      child.emit('close', result.code ?? 0)
    })
    return child
  }
  return { spawnImpl, calls }
}

/** A filesystem double: the named files exist and the named links resolve. */
function fsRules({ files = [], links = {} } = {}) {
  const fileSet = new Set(files)
  const linkMap = new Map(Object.entries(links))
  return {
    async stat(path) {
      if (fileSet.has(path)) return { isFile: () => true }
      const error = new Error(`ENOENT ${path}`)
      error.code = 'ENOENT'
      throw error
    },
    async realpath(path) {
      if (linkMap.has(path)) return linkMap.get(path)
      const error = new Error(`ENOENT ${path}`)
      error.code = 'ENOENT'
      throw error
    },
  }
}

/** The status of a fully linked, shell-visible POSIX install. */
function linkedSystem() {
  const binDir = globalBinDir(POSIX_PREFIX, 'linux')
  const shim = join(binDir, 'vib')
  // The probe output is a Linux path whatever host runs the test, so build it
  // in the POSIX flavour rather than the test host's.
  const probed = posix.join(POSIX_PREFIX, 'bin', 'vib')
  const { spawnImpl } = spawnRules({
    'npm prefix -g': { stdout: `${POSIX_PREFIX}\n` },
    '/bin/zsh -ilc command -v vib': { stdout: `${probed}\n` },
  })
  const fsImpl = fsRules({
    files: [shim],
    links: {
      [CHECKOUT]: CHECKOUT,
      [join(POSIX_PREFIX, 'node_modules', CLI_PACKAGE)]: CHECKOUT,
    },
  })
  return { spawnImpl, fsImpl, probed, binDir }
}

test('the platform facts are declared once', () => {
  assert.equal(globalBinDir(POSIX_PREFIX, 'linux'), join(POSIX_PREFIX, 'bin'))
  assert.equal(globalBinDir(WIN_PREFIX, 'win32'), WIN_PREFIX)

  const winShims = shimPaths(WIN_PREFIX, 'win32')
  assert.ok(winShims.some((path) => path.endsWith('vib.cmd')))
  assert.ok(winShims.some((path) => path.endsWith('vib.ps1')))
  assert.ok(shimPaths(POSIX_PREFIX, 'linux').some((path) => path.endsWith(join('bin', 'vib'))))

  assert.match(pathLine(join(POSIX_PREFIX, 'bin'), 'linux'), /^export PATH=.*\$PATH"$/u)
  assert.match(pathLine(WIN_PREFIX, 'win32'), /^setx PATH /u)
  assert.equal(directInvocation(CHECKOUT), `node "${join(CHECKOUT, 'bin', 'vib.js')}"`)
})

test('output parsers keep only what they can use', () => {
  assert.equal(parsePrefix('/home/u/.nvm/versions/node/v24\n'), '/home/u/.nvm/versions/node/v24')
  assert.equal(parsePrefix('\n'), null)

  assert.equal(parseProbe('/home/u/bin/vib\n', 'linux'), '/home/u/bin/vib')
  assert.equal(parseProbe('nvm: something\n', 'linux'), null)
  assert.equal(parseProbe('C:\\Users\\u\\npm\\vib.cmd\r\n', 'win32'), 'C:\\Users\\u\\npm\\vib.cmd')

  const posix = probeCommands('linux', '/bin/zsh')
  assert.deepEqual(posix[0], { command: '/bin/zsh', args: ['-ilc', 'command -v vib'] })
  assert.deepEqual(posix[2], { command: '/bin/sh', args: ['-lc', 'command -v vib'] })
  assert.deepEqual(probeCommands('win32'), [{ command: 'where', args: ['vib'] }])
})

test('an available command reports the path and owns it', async () => {
  const { spawnImpl, fsImpl, probed } = linkedSystem()
  const cli = createCli({
    checkout: CHECKOUT,
    platform: 'linux',
    env: { SHELL: '/bin/zsh' },
    spawnImpl,
    fsImpl,
  })

  const status = await cli.status()

  assert.equal(status.state, 'available')
  assert.equal(status.path, probed)
  assert.equal(status.shell, '/bin/zsh')
  assert.equal(status.owned, true)
  assert.equal(status.npm, true)
  assert.equal(status.pathLine, null)
})

test('a link the shell cannot see offers the PATH line', async () => {
  const binDir = globalBinDir(POSIX_PREFIX, 'linux')
  const shim = join(binDir, 'vib')
  const { spawnImpl } = spawnRules({
    'npm prefix -g': { stdout: `${POSIX_PREFIX}\n` },
    '/bin/zsh -ilc command -v vib': { code: 1 },
    '/bin/zsh -lc command -v vib': { code: 1 },
    '/bin/sh -lc command -v vib': { code: 1 },
  })
  const fsImpl = fsRules({
    files: [shim],
    links: { [CHECKOUT]: CHECKOUT, [join(POSIX_PREFIX, 'node_modules', CLI_PACKAGE)]: CHECKOUT },
  })
  const cli = createCli({ checkout: CHECKOUT, platform: 'linux', env: { SHELL: '/bin/zsh' }, spawnImpl, fsImpl })

  const status = await cli.status()

  assert.equal(status.state, 'linked')
  assert.equal(status.owned, true)
  assert.equal(status.pathLine, `export PATH="${binDir}:$PATH"`)
})

test('no shim and no shell hit is missing', async () => {
  const { spawnImpl } = spawnRules({
    'npm prefix -g': { stdout: `${POSIX_PREFIX}\n` },
    '/bin/zsh -ilc command -v vib': { code: 1 },
    '/bin/zsh -lc command -v vib': { code: 1 },
    '/bin/sh -lc command -v vib': { code: 1 },
  })
  const cli = createCli({
    checkout: CHECKOUT,
    platform: 'linux',
    env: { SHELL: '/bin/zsh' },
    spawnImpl,
    fsImpl: fsRules(),
  })

  const status = await cli.status()

  assert.equal(status.state, 'missing')
  assert.equal(status.pathLine, null)
  assert.ok(status.direct.includes(join('bin', 'vib.js')))
})

test('npm being unavailable is unknown, not a false missing', async () => {
  const { spawnImpl } = spawnRules({
    'npm prefix -g': { error: Object.assign(new Error('npm not found'), { code: 'ENOENT' }) },
  })
  const cli = createCli({
    checkout: CHECKOUT,
    platform: 'linux',
    env: { SHELL: '/bin/zsh' },
    spawnImpl,
    fsImpl: fsRules(),
  })

  const status = await cli.status()

  assert.equal(status.npm, false)
  assert.equal(status.state, 'unknown')
  assert.match(status.message, /npm is not available/u)
})

test('install needs confirmation and then links the checkout', async () => {
  const binDir = globalBinDir(POSIX_PREFIX, 'linux')
  const shim = join(binDir, 'vib')
  const probed = posix.join(POSIX_PREFIX, 'bin', 'vib')
  let installed = false
  const { spawnImpl, calls } = spawnRules({
    'npm prefix -g': { stdout: `${POSIX_PREFIX}\n` },
    '/bin/zsh -ilc command -v vib': () => (installed ? { stdout: `${probed}\n` } : { code: 1 }),
    '/bin/zsh -lc command -v vib': { code: 1 },
    '/bin/sh -lc command -v vib': { code: 1 },
    'npm link': () => {
      installed = true
      return { code: 0, stdout: 'added 1 package\n' }
    },
  })
  const fsImpl = {
    async stat(path) {
      if (installed && path === shim) return { isFile: () => true }
      const error = new Error('ENOENT')
      error.code = 'ENOENT'
      throw error
    },
    async realpath(path) {
      if (path === CHECKOUT) return CHECKOUT
      if (installed && path === join(POSIX_PREFIX, 'node_modules', CLI_PACKAGE)) return CHECKOUT
      const error = new Error('ENOENT')
      error.code = 'ENOENT'
      throw error
    },
  }
  const cli = createCli({ checkout: CHECKOUT, platform: 'linux', env: { SHELL: '/bin/zsh' }, spawnImpl, fsImpl })

  const refused = await cli.install({})
  assert.equal(refused.ok, false)
  assert.equal(refused.code, 'confirmation-required')
  assert.equal(calls.some((call) => call.args.includes('link')), false)

  const installedNow = await cli.install({ confirm: true })
  assert.equal(installedNow.ok, true)
  assert.equal(installedNow.status.state, 'available')
  assert.equal(installedNow.status.path, probed)
  assert.equal(installedNow.status.owned, true)
})

test('a failing npm link reports its own code', async () => {
  const { spawnImpl } = spawnRules({
    'npm prefix -g': { stdout: `${POSIX_PREFIX}\n` },
    '/bin/zsh -ilc command -v vib': { code: 1 },
    '/bin/zsh -lc command -v vib': { code: 1 },
    '/bin/sh -lc command -v vib': { code: 1 },
    'npm link': { code: 1, stderr: 'npm ERR! EACCES: permission denied\n' },
  })
  const cli = createCli({
    checkout: CHECKOUT,
    platform: 'linux',
    env: { SHELL: '/bin/zsh' },
    spawnImpl,
    fsImpl: fsRules(),
  })

  const result = await cli.install({ confirm: true })

  assert.equal(result.ok, false)
  assert.equal(result.code, 'npm-link-failed')
  assert.match(result.message, /EACCES/u)
})

test('remove refuses a foreign install', async () => {
  const binDir = globalBinDir(POSIX_PREFIX, 'linux')
  const shim = join(binDir, 'vib')
  const { spawnImpl, calls } = spawnRules({
    'npm prefix -g': { stdout: `${POSIX_PREFIX}\n` },
    '/bin/zsh -ilc command -v vib': { code: 1 },
    '/bin/zsh -lc command -v vib': { code: 1 },
    '/bin/sh -lc command -v vib': { code: 1 },
    'npm unlink -g': { code: 0 },
  })
  const fsImpl = fsRules({
    files: [shim],
    links: { [CHECKOUT]: CHECKOUT, [join(POSIX_PREFIX, 'node_modules', CLI_PACKAGE)]: '/other/viburnum' },
  })
  const cli = createCli({ checkout: CHECKOUT, platform: 'linux', env: { SHELL: '/bin/zsh' }, spawnImpl, fsImpl })

  const result = await cli.remove({ confirm: true })

  assert.equal(result.ok, false)
  assert.equal(result.code, 'not-ours')
  assert.equal(calls.some((call) => call.args.includes('unlink')), false)
})

test('remove unlinks our own install', async () => {
  const binDir = globalBinDir(POSIX_PREFIX, 'linux')
  const shim = join(binDir, 'vib')
  let installed = true
  const { spawnImpl } = spawnRules({
    'npm prefix -g': { stdout: `${POSIX_PREFIX}\n` },
    '/bin/zsh -ilc command -v vib': () => (installed ? { stdout: `${shim}\n` } : { code: 1 }),
    '/bin/zsh -lc command -v vib': { code: 1 },
    '/bin/sh -lc command -v vib': { code: 1 },
    'npm unlink -g dsh-plugin-viburnum': () => {
      installed = false
      return { code: 0 }
    },
  })
  const fsImpl = {
    async stat(path) {
      if (installed && path === shim) return { isFile: () => true }
      const error = new Error('ENOENT')
      error.code = 'ENOENT'
      throw error
    },
    async realpath(path) {
      if (path === CHECKOUT) return CHECKOUT
      if (installed && path === join(POSIX_PREFIX, 'node_modules', CLI_PACKAGE)) return CHECKOUT
      const error = new Error('ENOENT')
      error.code = 'ENOENT'
      throw error
    },
  }
  const cli = createCli({ checkout: CHECKOUT, platform: 'linux', env: { SHELL: '/bin/zsh' }, spawnImpl, fsImpl })

  const result = await cli.remove({ confirm: true })

  assert.equal(result.ok, true)
  assert.equal(result.status.state, 'missing')
})

test('Windows uses where and the npm bin directory', async () => {
  const shims = shimPaths(WIN_PREFIX, 'win32')
  const shim = shims.find((path) => path.endsWith('vib.cmd'))
  const { spawnImpl } = spawnRules({
    'cmd.exe /d /s /c npm.cmd prefix -g': { stdout: `${WIN_PREFIX}\r\n` },
    'where vib': { stdout: `${shim}\r\n` },
  })
  const fsImpl = fsRules({
    files: [shim],
    links: { [CHECKOUT]: CHECKOUT, [join(WIN_PREFIX, 'node_modules', CLI_PACKAGE)]: CHECKOUT },
  })
  const cli = createCli({
    checkout: CHECKOUT,
    platform: 'win32',
    env: { ComSpec: 'cmd.exe', SHELL: '' },
    spawnImpl,
    fsImpl,
  })

  const status = await cli.status()

  assert.equal(status.state, 'available')
  assert.equal(status.path, shim)
  assert.equal(status.binDir, WIN_PREFIX)
  assert.equal(status.owned, true)
})
