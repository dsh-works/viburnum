# Changelog

## Unreleased

### Fixed

- The page transport now registers once the Web server is provided instead of reading it once at
  apply time, so a profile whose entries compose out of order no longer shows a grey sidebar dot
  with "The Host did not answer." and "refused: transport" on the viburnum page.
- The sidebar glyph is the real `blue-butterfly` pixel art, rendered larger; the status dot now sits
  centred in the gap between the icon and the label. The package icon is `blue-butterfly.png` too.

## 0.1.0 — 2026-11-06

First build of the sync core, the sidebar row and the page.

### Added

- Host core that reads the profile's mounted linked bundles, checks their git state, and owns tracks,
  cached rows, receipts and snapshots in `$DSH_HOME/profiles/<profile>/.viburnum/state.json`.- `sidebar.panellist` glyph with the aggregate status dot, and the viburnum page in the `main` slot:
  per-bundle track, direction counts, directory, incoming changelog, `Refresh`, `Sync all`,
  `Update`, `Sync`, `Revert` and a track selector.
- Moves: fast-forward-only update, two-way sync (push, pull, rebase private divergence), published
  divergence refusal, conflicting-rebase abort, track switch with reload class, snapshot revert.
- Model-facing tools `vib_status`, `vib_update`, `vib_sync`, `vib_switch`, `vib_revert`; mutating
  tools ask the approval service first.
- `vib` CLI: `status`, `refresh`, `update`, `sync`, `switch`, `revert`, with `--json` and `--dry-run`.
- Configuration: `checkIntervalMinutes`, `fetchTimeoutMs`, `catalogOwners`, `pluginsDir`.
- Offline fixture repositories (bare origin, two clones, divergence and conflict worlds) and 78
  tests under `node --test`.

### Verified

- Installed into the `web` profile with the plugin manager and applied without warnings.
- Tools, sidebar entry and main page registered live; the browser half fetched `/viburnum/status`.
- CLI and page transport report the three mounted bundles as current.

### English only

- The `zh` locale was removed; UI copy ships in English, and another language is added only when
  the plugin actually ships one (the updated `dsh-plugin-development` rule).

### Repository made public

- MIT licence added; README rewritten for a public, community-facing project; `CONTRIBUTING.md` and
  `SECURITY.md` added; personal paths and handles removed from docs and tests.
- The `dsh-plugin-development` rulebook is linked as the process every change follows.

### Not verified in 0.1.0

- Visual checks in light/dark, an approval prompt end to end, a real move on a user checkout, and
  the second machine.

### Not in 0.1.0

- Install doors, the per-plugin workbench page, `vib new`, organisation catalog, timeline, hygiene.
