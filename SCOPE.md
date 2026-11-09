# Scope

What viburnum ships in which version, and what it deliberately never does. The premise and the
decisions live in [`DESIGN.md`](DESIGN.md); the approved build plan and its acceptance checks live in
[`docs/PLAN.md`](docs/PLAN.md).

## 0.1.0 — the sync core

- One profile; `link:` and `file:` dependencies only.
- Sidebar row with the aggregate dot, ordered above Plugins.
- The viburnum page: mounted bundles, tracks, direction counts, directory, changelog, `Refresh`,
  `Sync all`, and per-bundle `Update`, `Sync`, `Revert`, track switch.
- Per-machine tracks; state, receipts and snapshots with the profile.
- `vib_status`, `vib_update`, `vib_sync`, `vib_switch`, `vib_revert`; approval before every move.
- `vib status | refresh | update | sync | switch | revert`.
- Offline fixture repositories and `npm run check` as the gate.

## 0.2.0 — adoption and the workbench

- Install doors: directory (native Browse), repository URL, GitHub organisation with a cached catalog
  (the shared `$GITHUB_TOKEN`/`$GH_TOKEN` when present), and the shelf (`pluginsDir`), all through the
  plugin manager's `installBundle`.
- The per-plugin workbench page: branch hero control, incoming changelog rendered as Markdown, version
  drift and reload class, inline README/CHANGELOG, folder open in the desktop, and whole-row entry.
- Page polish: plugin icons per row, versions, timeline feed, hygiene scan, sidebar ahead/behind counts.
- `vib new`, the CLI spelling of the install doors (`vib install`), `vib log`, `vib hygiene`.
- A Settings → viburnum page (refresh schedule, startup refresh, checkout directory, version warnings)
  and harness-drift tracking against `engines.dsh`.
- Organisation repository creation (`vib new --push`) and `vib_brief` move to 0.3.

## Not planned

- Registry bundles, dependency installation, multi-profile, notifications, diff stat, tray integration.
- Commits, force-push, rebase of published commits, any automatic move without a click or a command.

## Boundaries

- viburnum never moves a checkout the profile did not link; it records `origin: 'linked'` for what it
  watches, and only 0.2's shelf checkouts may ever be removed by it.
- The page talks to the Host only through the plugin's own same-origin JSON routes; no iframe, no
  second server, no DOM writes outside the plugin's components.
- State stays with the profile, never in a bundle repository.
