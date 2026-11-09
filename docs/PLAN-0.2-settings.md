# workbench page — icons, sidebar counts, settings and harness drift delta

- **Tier:** feature on a released plugin (viburnum 0.1.0), eighth delta of 0.2
- **Revision:** 1
- **Parent plan:** [`PLAN-0.2.md`](PLAN-0.2.md)
- **Approved by:** the repository owner on 2026-11-09 (page icons, sidebar ahead/behind, Settings page, version-conflict warnings)

## Outcome

Four surfaces the workbench still lacked:

- **Bundle icons on the page:** each row shows the linked plugin's declared `package.json` icon, left of
  the name, inlined as a data URI (≤200 KB) so the page needs no extra route.
- **Ahead/behind in the sidebar:** the viburnum row carries the aggregate `↑a ↑b` counts at its right
  edge, next to the dot.
- **A Settings → viburnum page** (the `settings.section` seat the Alerts plugin uses): refresh interval,
  refresh-on-startup, and version-drift warnings, saved with the profile state (no profile-file edit) and
  applied without a reload (the Host ticks every minute and reads the saved settings).
- **Harness drift tracking:** the Host records the running `@deepseek-ai/dsh` version, warns when it
  changes between runs, and flags every mounted bundle whose `engines.dsh` range rejects the running
  harness — the "new harness dropped, bump and fix the plugins" warning.

## Surface

- **Host:** `lib/version-check.js` (parse/compare/satisfies with caret, tilde, comparator, `||`, unknown
  shapes accepted; running-version discovery by walking up from `process.argv[1]`).
  `lib/status.js` reads one manifest per row (version, `engines.dsh`, inlinable icon).
  `lib/core.js` persists `settings` and `dshVersion`, exposes `setSettings`, and adds
  `settings` + `compat` to the snapshot. Route action `settings`.
  `index.js` runs one check effect: startup refresh when enabled, then a one-minute tick that refreshes
  when the saved interval is due.
- **Browser:** row icons; sidebar counts; a settings section + nav glyph registered on
  `settings.section` / `settings.section.icon` with id `viburnum`.
- Rejected: editing `cordis.patch.yml` from the UI (settings live in `.viburnum/state.json`);
  a new icon route (data URIs are bounded and cached with the row).

## Non-goals for this delta

- Automatic version bumps or peer rewrites; the warning names the bundle, its range and the running version.
- Remote settings sync (settings are per profile/machine, like tracks).
- Editing the row's `Loader` config from the page.

## Acceptance checks

| # | Trigger | Expected result | Observed by | Result |
|---|---|---|---|---|
| 1 | Open the viburnum page | each row shows the plugin's icon left of the name; a plugin without one shows none | live page | not run |
| 2 | Sidebar row with a behind/ahead bundle | `↑n`/`↓n` at the row's right edge, dot still after the label | live page | not run |
| 3 | Settings → viburnum → change interval, toggle startup, Save | `saved`; the Host honours the interval on its next tick and skips the startup check when off | live page + logs | not run |
| 4 | A bundle whose `engines.dsh` rejects the running harness | warning on the settings page naming bundle, range and running version; toggling warnings off hides it | live page / route JSON | not run |
| 5 | A harness version change between runs | a `harness-update` warning once, then only the stored new version | route JSON | not run |
| 6 | `npm run check` | version-range, settings, compatibility, icon and sidebar-source tests pass | command transcript | **pending** |
