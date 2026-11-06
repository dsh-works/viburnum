/**
 * Changelog reading, version suggestion and reload classes.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { makeWorld } from './fixtures.mjs'
import {
  buildChangelog,
  changelogSectionFor,
  compareVersions,
  firstChangelogSection,
  parseChangelogSections,
  reloadClass,
  reloadLabel,
  suggestNextVersion,
} from '../lib/version.js'

const CHANGELOG = `# Changelog

## 0.4.0 - 2026-11-01

### Added

- A new panel.

## [0.3.0] - 2026-10-01

- The first release.

## Unreleased

- Work in progress.
`

test('changelog sections are split by version headings', () => {
  const sections = parseChangelogSections(CHANGELOG)
  assert.deepEqual(sections.map((section) => section.version), ['0.4.0', '0.3.0'])
  assert.match(sections[0].body, /A new panel/u)
  assert.match(sections[1].body, /The first release/u)

  assert.equal(changelogSectionFor(CHANGELOG, '0.3.0'), '- The first release.')
  assert.equal(changelogSectionFor(CHANGELOG, 'v0.4.0'), '### Added\n\n- A new panel.')
  assert.equal(changelogSectionFor(CHANGELOG, '9.9.9'), null)
  assert.equal(firstChangelogSection(CHANGELOG), '### Added\n\n- A new panel.')
})

test('the next version is the highest changelog version newer than the installed one', () => {
  assert.equal(suggestNextVersion(CHANGELOG, '0.3.0'), '0.4.0')
  assert.equal(suggestNextVersion(CHANGELOG, '0.4.0'), null)
  assert.equal(suggestNextVersion(CHANGELOG, '0.5.0'), null)
  assert.equal(suggestNextVersion('no versions here', '0.1.0'), null)
})

test('versions compare numerically', () => {
  assert.ok(compareVersions('0.4.0', '0.3.9') > 0)
  assert.ok(compareVersions('1.0.0', '0.9.9') > 0)
  assert.equal(compareVersions('v0.4.0', '0.4.0'), 0)
})

test('reload classes follow the changed paths', () => {
  assert.deepEqual(reloadClass(['client.js']), { browser: true, host: false, dependencies: false })
  assert.deepEqual(reloadClass(['lib/client.panel.js']), { browser: true, host: false, dependencies: false })
  assert.deepEqual(reloadClass(['locale/en.json']), { browser: true, host: false, dependencies: false })
  assert.deepEqual(reloadClass(['index.js']), { browser: false, host: true, dependencies: false })
  assert.deepEqual(reloadClass(['lib/git.js']), { browser: false, host: true, dependencies: false })
  assert.deepEqual(reloadClass(['package.json']), { browser: false, host: false, dependencies: true })
  assert.deepEqual(reloadClass(['README.md', 'test/x.test.mjs']), { browser: false, host: false, dependencies: false })
  assert.deepEqual(reloadClass(['README.md', 'index.js', 'client.js', 'package.json']), {
    browser: true,
    host: true,
    dependencies: true,
  })

  assert.match(reloadLabel({ browser: true, host: false, dependencies: false }), /refresh the page/u)
  assert.match(reloadLabel({ browser: false, host: true, dependencies: false }), /restart/u)
  assert.match(reloadLabel({ browser: true, host: true, dependencies: true }), /dependencies changed/u)
  assert.equal(reloadLabel({ browser: false, host: false, dependencies: false }), '')
})

test('buildChangelog prefers the named section, then the first section, then commits', async (t) => {
  const world = await makeWorld(t)

  await world.commit(world.laptop, 'CHANGELOG.md', CHANGELOG, 'add changelog')
  await world.push(world.laptop)
  await world.fetch(world.work)

  const named = await buildChangelog(world.work, {
    from: 'origin/main~1',
    to: 'origin/main',
    version: '0.3.0',
  })
  assert.equal(named, '- The first release.')

  const first = await buildChangelog(world.work, { from: 'origin/main~1', to: 'origin/main', version: '9.9.9' })
  assert.match(first, /A new panel/u)

  await world.commit(world.laptop, 'note.txt', 'no changelog change\n', 'a commit without a changelog')
  await world.push(world.laptop)
  await world.fetch(world.work)
  const fallback = await buildChangelog(world.work, {
    from: 'origin/main~1',
    to: 'origin/main',
    version: '0.4.0',
  })
  // The first section still wins even when a newer commit exists; that is the
  // design's "first hit wins" order.
  assert.match(fallback, /A new panel/u)

  const missing = await buildChangelog(world.work, { from: 'HEAD', to: 'HEAD' })
  assert.equal(missing, null)
})
