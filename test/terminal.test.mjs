/**
 * Terminal-launch command checks. The process launch is exercised through an
 * injected spawn implementation; no terminal is opened here.
 */

import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { test } from 'node:test'

import { openTerminalAt, terminalCommand, terminalIds, trySpawn } from '../lib/terminal.js'

/** A controllable stand-in for `node:child_process.spawn`. */
function fakeSpawn(behave) {
  const calls = []
  return {
    calls,
    spawnImpl(command, args) {
      const child = new EventEmitter()
      child.unref = () => {}
      calls.push({ command, args })
      behave(child, calls.length)
      return child
    },
  }
}

test('Windows prefers Windows Terminal and falls back to PowerShell', () => {
  const list = terminalCommand('win32', 'C:\\plugins\\demo')
  assert.deepEqual(list[0], { command: 'wt.exe', args: ['-d', 'C:\\plugins\\demo'] })
  assert.equal(list[1].command, 'powershell.exe')
  assert.ok(list[1].args.some((argument) => argument.includes('C:\\plugins\\demo')))
})

test('a preferred terminal is tried first', () => {
  const win = terminalCommand('win32', 'C:\\plugins\\demo', 'powershell')
  assert.equal(win[0].command, 'powershell.exe')
  assert.equal(win[1].command, 'wt.exe')

  const mac = terminalCommand('darwin', '/plugins/demo', 'iterm2')
  assert.equal(mac[0].command, 'open')
  assert.deepEqual(mac[0].args, ['-a', 'iTerm', '/plugins/demo'])
  const macTerminal = terminalCommand('darwin', '/plugins/demo', 'terminal')
  assert.deepEqual(macTerminal[0].args, ['-a', 'Terminal', '/plugins/demo'])

  const linux = terminalCommand('linux', '/plugins/demo', 'gnome-terminal')
  assert.equal(linux[0].command, 'gnome-terminal')
})

test('an unknown preference falls back to the platform order', () => {
  const list = terminalCommand('darwin', '/plugins/demo', 'not-a-terminal')
  assert.deepEqual(list[0].args, ['-a', 'iTerm', '/plugins/demo'])
})

test('the platform ids are the settings values', () => {
  assert.deepEqual(terminalIds('darwin'), ['auto', 'iterm2', 'terminal'])
  assert.deepEqual(terminalIds('win32'), ['auto', 'wt', 'powershell'])
})

test('macOS opens the app through LaunchServices, newest iTerm name first', () => {
  const list = terminalCommand('darwin', '/plugins/demo')
  assert.deepEqual(list, [
    { command: 'open', args: ['-a', 'iTerm', '/plugins/demo'] },
    { command: 'open', args: ['-a', 'iTerm2', '/plugins/demo'] },
    { command: 'open', args: ['-a', 'Terminal', '/plugins/demo'] },
  ])
})

test('a macOS directory with spaces is one launch argument, not a shell string', () => {
  for (const id of ['iterm2', 'terminal']) {
    const [command] = terminalCommand('darwin', '/Users/me/My Plugins', id)
    assert.equal(command.command, 'open')
    assert.equal(command.args.at(-1), '/Users/me/My Plugins')
    assert.ok(!command.args.some((argument) => argument.includes('&&')), 'no shell chaining is involved')
  }
})

test('Linux tries an x-terminal first', () => {
  const list = terminalCommand('linux', '/plugins/demo')
  assert.equal(list[0].command, 'x-terminal-emulator')
  assert.ok(list[0].args.includes('--working-directory=/plugins/demo'))
})

test('a relative directory is refused', () => {
  assert.throws(() => terminalCommand('win32', 'plugins/demo'), /absolute directory/u)
})

test('the xterm fallback runs a shell when $SHELL is unset', () => {
  const command = terminalCommand('linux', '/plugins/demo', 'xterm')[0]
  assert.ok(command.args.at(-1).includes('${SHELL:-/bin/sh}'), command.args.at(-1))
})

test('a launcher that throws is a failed candidate', async () => {
  const result = await trySpawn({ command: 'missing', args: [] }, {
    spawnImpl: () => { throw new Error('ENOENT') },
    graceMs: 5,
  })
  assert.equal(result, false)
})

test('a failed launcher falls through to the next terminal', async () => {
  const { spawnImpl, calls } = fakeSpawn((child, index) => {
    queueMicrotask(() => {
      if (index === 1) child.emit('error', new Error('ENOENT'))
      else child.emit('close', 0)
    })
  })

  const result = await openTerminalAt('/plugins/demo', { platform: 'darwin', spawnImpl, graceMs: 50 })

  assert.deepEqual(result, { ok: true })
  assert.equal(calls.length, 2)
  assert.equal(calls[0].args[1], 'iTerm')
  assert.equal(calls[1].args[1], 'iTerm2')
})

test('every failed launcher reports the terminal unavailable', async () => {
  const { spawnImpl } = fakeSpawn((child) => queueMicrotask(() => child.emit('close', 1)))

  const result = await openTerminalAt('/plugins/demo', { platform: 'linux', spawnImpl, graceMs: 50 })

  assert.equal(result.ok, false)
  assert.equal(result.code, 'terminal-unavailable')
})

test('a launcher still running past the grace period counts as opened', async () => {
  const { spawnImpl, calls } = fakeSpawn(() => {})

  const result = await openTerminalAt('/plugins/demo', { platform: 'linux', spawnImpl, graceMs: 5 })

  assert.deepEqual(result, { ok: true })
  assert.equal(calls.length, 1)
})
