/**
 * Native directory picker checks: the platform command choice and the output
 * parsing. The dialog itself is interactive and is not opened here.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { pickedPath, pickerCandidates, pickerCommand } from '../lib/picker.js'

test('the Windows picker is a hidden STA PowerShell folder dialog', () => {
  const spec = pickerCommand('win32')
  assert.equal(spec.command, 'powershell.exe')
  assert.equal(spec.cancelledExit, 2)
  assert.ok(spec.args.includes('-STA'))
  assert.ok(spec.args.some((arg) => arg.includes('FolderBrowserDialog')))
})

test('macOS and Linux get their own native pickers', () => {
  assert.equal(pickerCommand('darwin').command, 'osascript')
  assert.equal(pickerCommand('darwin').cancelledExit, 1)
  assert.equal(pickerCommand('linux').command, 'zenity')
  assert.ok(pickerCommand('linux').args.includes('--directory'))
})

test('Linux falls back to kdialog when zenity is absent', () => {
  const candidates = pickerCandidates('linux')
  assert.equal(candidates[0].command, 'zenity')
  assert.equal(candidates[1].command, 'kdialog')
  assert.ok(candidates[1].args.includes('--getexistingdirectory'))
  assert.equal(candidates[1].cancelledExit, 1)

  assert.deepEqual(pickerCandidates('win32'), [pickerCommand('win32')])
  assert.deepEqual(pickerCandidates('darwin'), [pickerCommand('darwin')])
})

test('only an absolute path is accepted from the picker output', () => {
  const absolute = process.platform === 'win32' ? 'C:\\plugins\\demo' : '/plugins/demo'
  const relative = process.platform === 'win32' ? 'plugins\\demo' : 'plugins/demo'

  assert.equal(pickedPath(absolute), absolute)
  assert.equal(pickedPath(`notice line\n${absolute}\n`), absolute)
  assert.equal(pickedPath(relative), null)
  assert.equal(pickedPath(''), null)
})
