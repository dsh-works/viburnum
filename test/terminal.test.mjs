/**
 * Terminal-launch command checks. The process launch is not exercised here.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { terminalCommand, terminalIds } from '../lib/terminal.js'

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
  assert.equal(mac[0].command, 'osascript')
  assert.match(mac[0].args[1], /iTerm2/u)
  const macTerminal = terminalCommand('darwin', '/plugins/demo', 'terminal')
  assert.match(macTerminal[0].args[1], /Terminal/u)

  const linux = terminalCommand('linux', '/plugins/demo', 'gnome-terminal')
  assert.equal(linux[0].command, 'gnome-terminal')
})

test('an unknown preference falls back to the platform order', () => {
  const list = terminalCommand('darwin', '/plugins/demo', 'not-a-terminal')
  assert.match(list[0].args[1], /iTerm2/u)
})

test('the platform ids are the settings values', () => {
  assert.deepEqual(terminalIds('darwin'), ['auto', 'iterm2', 'terminal'])
  assert.deepEqual(terminalIds('win32'), ['auto', 'wt', 'powershell'])
})

test('macOS uses Terminal through osascript', () => {
  const list = terminalCommand('darwin', '/plugins/demo')
  assert.equal(list.length, 2)
  assert.equal(list[0].command, 'osascript')
  assert.match(list[0].args[1], /iTerm2/u)
})

test('Linux tries an x-terminal first', () => {
  const list = terminalCommand('linux', '/plugins/demo')
  assert.equal(list[0].command, 'x-terminal-emulator')
  assert.ok(list[0].args.includes('--working-directory=/plugins/demo'))
})

test('a relative directory is refused', () => {
  assert.throws(() => terminalCommand('win32', 'plugins/demo'), /absolute directory/u)
})
