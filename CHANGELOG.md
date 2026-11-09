# Changelog

## Unreleased

### Added

- `vib new <name> [--dir <path>] [--git]` scaffolds a Host-only bundle that satisfies the taxonomy:
  package manifest, bundle patch row, entry module, a passing test and a README; names normalize to
  `dsh-plugin-<slug>`, a non-empty target is refused, and `--git` adds an initial local commit.
- `vib install <path|url|owner/repo>` is the CLI spelling of the install doors: it posts to the
  running Host's guarded install action (`--host`, `$VIBURNUM_HOST`, `$DSH_WEB_URL`, default
  `http://127.0.0.1:3080`), resolves `.` to the current directory, and prints the same receipt or
  refusal.
- The install form's **Organisation** door lists the repositories of the configured GitHub owners
  (`catalogOwners`), marks archived ones, caches successful reads for ten minutes, offers a manual
  refresh, and installs a picked `owner/repo` through the repository door (shelf clone + link). A
  `$GITHUB_TOKEN`/`$GH_TOKEN` is used when present.
- Install doors on the page: **Directory** links an existing checkout through
  `pluginManager.installBundle` (with a **Browse…** button that opens the Host's native folder dialog for
  the absolute path), and **Repository URL** clones `owner/repo` or an https/ssh git URL into the
  configurable shelf (`pluginsDir`, default `$DSH_HOME/viburnum/plugins`) before linking it. Refusals cover
  bad paths, non-bundles, already-linked checkouts, occupied shelf slots and clone failures; nothing is
  overwritten or auto-removed.
- A bundle's README and CHANGELOG open **inside** the detail view, rendered as Markdown (headings,
  lists, tables, code, links) by a small safe renderer; the incoming changelog uses it too. Only the
  folder still opens externally.
- The viburnum page header shows its own version, and every bundle row shows the linked plugin's
  declared version next to its name; the detail already showed the target version.
- The workbench detail view can hand a bundle's folder, README or CHANGELOG to the desktop through
  the harness's verified native path opener (`sessionController.openWorkspacePath`), with the same
  `missing-file` / `open-unavailable` refusals on the guarded page route.

### Fixed

- The page transport now registers once the Web server is provided instead of reading it once at
  apply time, so a profile whose entries compose out of order no longer shows a grey sidebar dot
  with "The Host did not answer." and "refused: transport" on the viburnum page.
- The sidebar glyph is the real `blue-butterfly` pixel art. Its 64×64 canvas carried 8/4/3/15 px of
  transparent edge, so the mark is now shipped as a 52×46 trimmed crop and drawn much larger; the
  status dot sits between the glyph and the label. The package icon is the same trimmed mark.

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
