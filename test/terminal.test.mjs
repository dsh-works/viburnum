/**
 * Terminal-launch command checks. The process launch is not exercised here.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { terminalCommand } from '../lib/terminal.js'

test('Windows prefers Windows Terminal and falls back to PowerShell', () => {
  const list = terminalCommand('win32', 'C:\\plugins\\demo')
  assert.deepEqual(list[0], { command: 'wt.exe', args: ['-d', 'C:\\plugins\\demo'] })
  assert.equal(list[1].command, 'powershell.exe')
  assert.ok(list[1].args.some((argument) => argument.includes('C:\\plugins\\demo')))
})

test('macOS uses Terminal through osascript', () => {
  const list = terminalCommand('darwin', '/plugins/demo')
  assert.equal(list.length, 1)
  assert.equal(list[0].command, 'osascript')
  assert.match(list[0].args[1], /Terminal/u)
})

test('Linux tries an x-terminal first', () => {
  const list = terminalCommand('linux', '/plugins/demo')
  assert.equal(list[0].command, 'x-terminal-emulator')
  assert.ok(list[0].args.includes('--working-directory=/plugins/demo'))
})

test('a relative directory is refused', () => {
  assert.throws(() => terminalCommand('win32', 'plugins/demo'), /absolute directory/u)
})
