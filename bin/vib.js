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

import { resolve } from 'node:path'

import { createCore } from '../lib/core.js'
import { scanHygiene } from '../lib/hygiene.js'
import { readProfileBundles } from '../lib/profile.js'
import { scaffoldPlugin } from '../lib/scaffold.js'

const DEFAULT_HOST = 'http://127.0.0.1:3080'

const USAGE = `viburnum - keeps all linked installs neatly synced in two universes

Usage:
  vib status [--json]                 cached rows and directions (local read only)
  vib refresh [--json]                fetch and re-check every mounted bundle
  vib update [<bundle>] [--json]      fast-forward one bundle, or all of them
  vib sync [<bundle>] [--dry-run]     push, pull or rebase; --json for machines
  vib switch <bundle> <track>         switch one bundle to another branch
  vib revert <bundle>                 restore the latest update or switch snapshot
  vib log [--json]                    show (and clear) what changed since the last look
  vib hygiene [--json]                scan the workspace and shelf for drift; nothing is deleted
  vib install <path|url|owner/repo>   install through the running viburnum page route
  vib new <name> [--dir <path>] [--git]
                                       scaffold a Host-only bundle that satisfies the taxonomy

Options:
  --profile <name>   profile to read (default: $DSH_PROFILE or web)
  --host <url>       viburnum Host origin for install (default: $VIBURNUM_HOST, $DSH_WEB_URL, http://127.0.0.1:3080)
  --dir <path>       target directory for new (default: ./<package name>)
  --git              initialise the scaffolded bundle and make its first commit
  --json             print JSON instead of the table
  --dry-run          fetch, then print the sync plan without moving the tree or pushing
  -h, --help         show this help

Exit: 0 success, 1 failure, 3 pending (behind or ahead).`

/** Parse command-line arguments into flags and positionals. */
function parse(argv) {
  const flags = { json: false, dryRun: false, help: false, profile: undefined, host: undefined, dir: undefined, git: false }
  const positional = []

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--json') flags.json = true
    else if (argument === '--dry-run') flags.dryRun = true
    else if (argument === '--git') flags.git = true
    else if (argument === '-h' || argument === '--help') flags.help = true
    else if (argument === '--profile') {
      flags.profile = argv[index + 1]
      index += 1
    } else if (argument.startsWith('--profile=')) {
      flags.profile = argument.slice('--profile='.length)
    } else if (argument === '--host') {
      flags.host = argv[index + 1]
      index += 1
    } else if (argument.startsWith('--host=')) {
      flags.host = argument.slice('--host='.length)
    } else if (argument === '--dir') {
      flags.dir = argv[index + 1]
      index += 1
    } else if (argument.startsWith('--dir=')) {
      flags.dir = argument.slice('--dir='.length)
    } else if (argument.startsWith('-')) {
      throw new Error(`unknown option: ${argument}`)
    } else {
      positional.push(argument)
    }
  }

  if (flags.profile !== undefined && flags.profile.trim() === '') throw new Error('--profile needs a name')
  if (flags.host !== undefined && flags.host.trim() === '') throw new Error('--host needs a URL')
  if (flags.dir !== undefined && flags.dir.trim() === '') throw new Error('--dir needs a path')
  return { flags, positional }
}

/** The viburnum Host origin: flag, environment, then the local default. */
function hostOf(flags, env = process.env) {
  const raw = flags.host ?? env.VIBURNUM_HOST ?? env.DSH_WEB_URL ?? DEFAULT_HOST
  return String(raw).trim().replace(/\/+$/u, '')
}

/** Decide the door for an install spelling: a path, or a repository. */
function installTarget(input, cwd = process.cwd()) {
  const text = String(input ?? '').trim()
  if (text === '') throw new Error('install needs a path, a repository URL or owner/repo')
  if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(text) || /^(https?:\/\/|ssh:\/\/|git@)/u.test(text)) {
    return { door: 'repository', spec: text }
  }
  return { door: 'directory', spec: resolve(cwd, text) }
}

/** Call one guarded page action on the running Host. */
async function pageAction(host, body, fetchImpl = globalThis.fetch) {
  let response
  try {
    response = await fetchImpl(`${host}/viburnum/action`, {
      method: 'POST',
      headers: { 'x-viburnum': '1', 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    })
  } catch (error) {
    throw new Error(`cannot reach the viburnum Host at ${host}; start the web profile or pass --host (${error.message})`)
  }
  let payload
  try {
    payload = await response.json()
  } catch {
    throw new Error(`the viburnum Host at ${host} returned a non-JSON answer (${response.status})`)
  }
  if (!response.ok && typeof payload?.message === 'string') throw new Error(payload.message)
  return payload
}

/** Print one install receipt or refusal. */
function printInstall(result) {
  if (result?.ok === true && result.installed === true) {
    console.log(`installed ${result.name ?? ''}${result.version ? ` v${result.version}` : ''}${result.cloned === true ? ' · cloned' : ''}`)
    return
  }
  console.error(`install refused: ${result?.code ?? 'error'} — ${result?.message ?? 'unknown failure'}`)
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

  // Install is the CLI spelling of the directory door, and the guarded route is
  // the only place with the plugin manager: the CLI calls the running page.
  if (command === 'install') {
    const target = installTarget(rest[0])
    const result = await pageAction(hostOf(flags), { action: 'install', ...target })
    if (flags.json) console.log(JSON.stringify(result, null, 2))
    else printInstall(result)
    return result?.ok === true ? 0 : 1
  }

  // Scaffolding is local: it needs no harness and no profile.
  if (command === 'new') {
    const result = await scaffoldPlugin({ name: rest[0], dir: flags.dir, git: flags.git })
    if (flags.json) {
      console.log(JSON.stringify(result, null, 2))
    } else {
      console.log(`created ${result.package} in ${result.dir}`)
      for (const file of result.files) console.log(`  ${file}`)
      if (result.git) console.log('git: initial commit created')
      if (result.warning) console.error(result.warning)
      console.log('next: cd into it and run `vib install .` with the Host running')
    }
    return 0
  }

  let core
  core = createCore({
    bundleSource: ({ env, argv: processArgv }) => readProfileBundles({
      explicit: flags.profile,
      env,
      argv: processArgv,
    }),
    hygieneScanner: () => scanHygiene({ roots: [process.cwd(), core.shelfDirectory] }),
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
      case 'log': {
        const feed = await core.timeline()
        if (flags.json) {
          console.log(JSON.stringify(feed, null, 2))
        } else if (feed.events.length === 0) {
          console.log('timeline: nothing new')
        } else {
          for (const event of feed.events) {
            const time = new Date(event.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            const extra = event.kind === 'incoming' && Array.isArray(event.subjects) && event.subjects.length > 0
              ? ` · ${event.subjects[0]}`
              : ''
            console.log(`${time} · ${event.bundle} · ${event.kind}: ${event.text ?? ''}${extra}`)
          }
        }
        return 0
      }
      case 'hygiene': {
        const result = await core.hygiene({ refresh: true })
        if (flags.json) {
          console.log(JSON.stringify(result, null, 2))
        } else if (result.ok === false) {
          console.error(`hygiene failed: ${result.code} — ${result.message}`)
        } else if (result.findings.length === 0) {
          console.log(`hygiene: clean (${result.checkouts.length} checkouts scanned)`)
        } else {
          for (const finding of result.findings) {
            if (finding.kind === 'duplicate-checkout') {
              console.log(`duplicate-checkout: ${finding.name}`)
              for (const dir of finding.dirs) console.log(`  ${dir}`)
            } else if (finding.kind === 'unmerged-branch') {
              console.log(`unmerged-branch: ${finding.name} — ${finding.branches.join(', ')}`)
            } else if (finding.kind === 'dirty-checkout') {
              console.log(`dirty-checkout: ${finding.name} — ${finding.dirtyCount} changes`)
            }
            if (finding.suggestion) console.log(`  suggest: ${finding.suggestion}`)
          }
        }
        return result.ok === false ? 1 : (result.findings.length > 0 ? 3 : 0)
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
