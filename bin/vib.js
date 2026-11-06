#!/usr/bin/env node
/**
 * `vib` — the command-line face of the same core the tools and the page use.
 *
 * There is no harness in this process: the profile's `package.json` supplies
 * the mounted bundles, and `$DSH_HOME`/`$DSH_PROFILE` decide the profile.
 *
 * Exit codes: 0 success, 1 failure, 3 something is pending (updates or
 * unpushed commits).
 *
 * @module dsh-plugin-viburnum/bin/vib
 */

import { createCore } from '../lib/core.js'
import { readProfileBundles } from '../lib/profile.js'

const USAGE = `vib — keep linked plugin checkouts current across two machines

Usage:
  vib status [--json]                 cached rows and directions (local read only)
  vib refresh [--json]                fetch and re-check every mounted bundle
  vib update [<bundle>] [--json]      fast-forward one bundle, or all of them
  vib sync [<bundle>] [--dry-run]     push, pull or rebase; --json for machines
  vib switch <bundle> <track>         switch one bundle to another branch
  vib revert <bundle>                 restore the latest update or switch snapshot

Options:
  --profile <name>   profile to read (default: $DSH_PROFILE or web)
  --json             print JSON instead of the table
  --dry-run          fetch, then print the sync plan without moving the tree or pushing
  -h, --help         show this help

Exit: 0 success, 1 failure, 3 pending (behind or ahead).`

/** Parse command-line arguments into flags and positionals. */
function parse(argv) {
  const flags = { json: false, dryRun: false, help: false, profile: undefined }
  const positional = []

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--json') flags.json = true
    else if (argument === '--dry-run') flags.dryRun = true
    else if (argument === '-h' || argument === '--help') flags.help = true
    else if (argument === '--profile') {
      flags.profile = argv[index + 1]
      index += 1
    } else if (argument.startsWith('--profile=')) {
      flags.profile = argument.slice('--profile='.length)
    } else if (argument.startsWith('-')) {
      throw new Error(`unknown option: ${argument}`)
    } else {
      positional.push(argument)
    }
  }

  if (flags.profile !== undefined && flags.profile.trim() === '') throw new Error('--profile needs a name')
  return { flags, positional }
}

/** `↑2 ↓3`, or `✓` when the row is level with its track. */
function arrows(row) {
  const parts = []
  if (row.ahead > 0) parts.push(`↑${row.ahead}`)
  if (row.behind > 0) parts.push(`↓${row.behind}`)
  return parts.join(' ') || '✓'
}

/** One human line per row. */
function printRows(snapshot) {
  const width = Math.max(0, ...snapshot.rows.map((row) => row.name.length))
  for (const row of snapshot.rows) {
    const track = row.track ?? '-'
    const stale = row.stale ? ' · stale' : ''
    const error = row.error ? ` · ${row.error}` : ''
    console.log(`${row.name.padEnd(width)}  ${track.padEnd(8)}  ${arrows(row)}  ${row.status}${stale}${error}`)
  }
  if (snapshot.rows.length === 0) console.log('no linked bundles')
  console.log(`dot: ${snapshot.dot} · checked ${snapshot.checkedAt ?? 'never'}`)
}

/** Print one action result as a short sentence. */
function printResult(kind, result) {
  if (result?.ok === false) {
    console.error(`${kind} failed: ${result.code} — ${result.message}`)
    if (result.files?.length) console.error(`conflicted: ${result.files.join(', ')}`)
    if (result.published?.length) console.error(`published: ${result.published.map((entry) => entry.sha).join(', ')}`)
    return
  }
  if (result?.dryRun === true) {
    const plan = result.plan
    console.log(`${kind} plan: ${plan.action}${plan.pulled ? ` ↓${plan.pulled}` : ''}${plan.rebased ? ` ↑${plan.rebased}` : ''}`)
    return
  }
  if (result?.nothing === true) {
    console.log(`${kind}: nothing to do`)
    return
  }
  if (Array.isArray(result?.results)) {
    for (const row of result.results) printResult(kind, row)
    console.log(`totals: pushed ${result.totals.pushed}, pulled ${result.totals.pulled}, rebased ${result.totals.rebased}`)
    return
  }
  const receipt = result?.receipt
  if (receipt) {
    const numbers = [`pushed ${receipt.pushed}`, `pulled ${receipt.pulled}`, `rebased ${receipt.rebased}`]
    if (receipt.track && receipt.kind === 'switch') numbers.unshift(`on ${receipt.track}`)
    console.log(`${kind}: ${numbers.join(', ')}`)
  }
}

/** Run one CLI invocation. */
async function main(argv) {
  const { flags, positional } = parse(argv)
  if (flags.help) {
    console.log(USAGE)
    return 0
  }

  const [command, ...rest] = positional
  if (command === undefined) {
    console.log(USAGE)
    return 1
  }

  const core = createCore({
    bundleSource: ({ env, argv: processArgv }) => readProfileBundles({
      explicit: flags.profile,
      env,
      argv: processArgv,
    }),
  })

  try {
    await core.load()

    switch (command) {
      case 'status': {
        const snapshot = await core.refresh({ fetch: false })
        if (flags.json) console.log(JSON.stringify(snapshot, null, 2))
        else printRows(snapshot)
        return snapshot.rows.some((row) => row.status !== 'current') ? 3 : 0
      }
      case 'refresh': {
        const snapshot = await core.refresh({ fetch: true })
        if (flags.json) console.log(JSON.stringify(snapshot, null, 2))
        else printRows(snapshot)
        return snapshot.rows.some((row) => row.status !== 'current') ? 3 : 0
      }
      case 'update': {
        const result = await core.update(rest[0] ?? null)
        if (flags.json) console.log(JSON.stringify(result, null, 2))
        else printResult('update', result)
        return result.ok ? 0 : 1
      }
      case 'sync': {
        const result = await core.sync(rest[0] ?? null, { dryRun: flags.dryRun })
        if (flags.json) console.log(JSON.stringify(result, null, 2))
        else printResult('sync', result)
        return result.ok || result.dryRun ? 0 : 1
      }
      case 'switch': {
        const [name, track] = rest
        if (name === undefined || track === undefined) throw new Error('switch needs <bundle> <track>')
        const result = await core.switch(name, track)
        if (flags.json) console.log(JSON.stringify(result, null, 2))
        else printResult('switch', result)
        return result.ok ? 0 : 1
      }
      case 'revert': {
        const [name] = rest
        if (name === undefined) throw new Error('revert needs <bundle>')
        const result = await core.revert(name)
        if (flags.json) console.log(JSON.stringify(result, null, 2))
        else printResult('revert', result)
        return result.ok ? 0 : 1
      }
      default:
        console.error(`unknown command: ${command}`)
        console.log(USAGE)
        return 1
    }
  } finally {
    await core.close()
  }
}

try {
  process.exitCode = await main(process.argv.slice(2))
} catch (error) {
  console.error(`vib: ${error.message}`)
  process.exitCode = 1
}
