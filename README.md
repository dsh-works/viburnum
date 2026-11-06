# Viburnum

*A manager that Keeps All Linked Installs Neatly Synced In Two Universes.*

A workbench for your own DeepSeek Harness plugins: create them, mount them, choose which version runs,
and keep two machines in sync. It watches the clones your profile is linked to, and one click fetches,
pushes, fast-forwards or rebases each one onto the branch it follows — so both machines run the same code
without you remembering which one pushed last.

A row in the sidebar carries one dot: green when everything is current, violet when something can be
pulled, orange when work is uncommitted, red when it is unpushed or diverged. Installing from a
directory, a repository URL or a GitHub organisation follows in 0.2.

Named after the shrub that holds its berries through the winter: in place, visible, current. The
command is `vib`; `viburnum` works too.

```
laptop ⇄ origin ⇄ work machine
             one click: fetch → ff | rebase → push
```

Each bundle follows a **track** — `main`, or `dev` while you are trying something — and the track is
per machine, so the laptop can try `dev` while the work machine stays on `main`. Switching is the same
button with the other branch. An update is a fetch and a fast-forward in the linked directory, so
there is no pnpm run, no lockfile write, and no profile edit.

Viburnum never commits and never force-pushes. When a rebase would rewrite something already
published, it stops and shows both sides; when the rebase conflicts, it aborts and hands you the files.

**Status: 0.1.0 release candidate, running from the `dev` line.** [`docs/PLAN.md`](docs/PLAN.md) is
the approved plan and carries the gate-3 evidence; [`DESIGN.md`](DESIGN.md) carries the premise and
decisions. `main` is the stable line (see [Branches](#branches)).

## What 0.1.0 does

- **One dot** in the sidebar, above Plugins: the worst state across every linked checkout — green
  current, violet pullable, orange uncommitted, red unpushed or diverged, grey unknown.
- **The Viburnum page**: the mounted checkouts with their track, fresh/behind/ahead counts, directory,
  the incoming changelog, and `Refresh` / `Sync all`; per bundle `Update`, `Sync`, `Revert` and a track
  selector. Nothing is modal; a blocked row never stops the next one.
- **Moves**: `Update` is a fetch and a fast-forward. `Sync` pushes unpublished commits, fast-forwards,
  or rebases private divergence and pushes it; it refuses to rebase published history and aborts a
  conflicting rebase before reporting it. `Revert` restores the latest update or switch snapshot.
- **Five model-facing tools**: `vib_status`, `vib_update`, `vib_sync`, `vib_switch`, `vib_revert`.
  Reads are free; every move asks for approval.
- **A CLI**: `vib status | refresh | update | sync | switch | revert`, plus `--json` and `--dry-run`.
- **State with the profile**: tracks, cached rows, receipts and snapshots at
  `$DSH_HOME/profiles/<profile>/.viburnum/state.json`, written atomically and pruned on write.

Not in 0.1.0: install doors (directory, repository URL, organisation), the per-plugin workbench page,
`vib new`, organisation catalog, timeline and hygiene. Those are scoped in [`SCOPE.md`](SCOPE.md).

## Install

The plugin is installed into a profile by the plugin manager, never by hand:

```powershell
dsh plugin --profile web add C:\Users\<you>\Documents\deepseek-harness\viburnum
```

The CLI needs `vib` on `PATH` only for terminal use:

```powershell
cd C:\Users\<you>\Documents\deepseek-harness\viburnum
npm link
```

## Configure

The row is `viburnum` in `cordis.patch.yml`; override any field by id:

```yaml
- id: viburnum
  config:
    checkIntervalMinutes: 15
    fetchTimeoutMs: 30000
```

| Field | Default | Meaning |
|---|---|---|
| `checkIntervalMinutes` | `5` | Background check interval; `0` disables checks on start and on a timer (on-demand only). |
| `fetchTimeoutMs` | `20000` | Bound on one git process, including a fetch. |
| `catalogOwners` | `['dsh-works']` | GitHub owners the 0.2 organisation door will read. |
| `pluginsDir` | `''` | Shelf directory for 0.2 installs; empty means `$DSH_HOME/viburnum/plugins`. |

Invalid configuration fails the plugin load with the field and range named.

## The state file

`$DSH_HOME/profiles/<profile>/.viburnum/state.json` is owned by the plugin: `version: 2`, bundle
records (track, last check, cached row), a 50-entry action history, and 20 update/switch snapshots
kept for 30 days. The page, the tools and the CLI share it through the one core; writes are
temp-file + rename.

The page's data does not travel through a generated Remote endpoint — an out-of-tree bundle cannot add
one. It uses two same-origin JSON routes registered on the Host web server,
`/viburnum/status` and `/viburnum/action`, which require the `x-viburnum: 1` header so a cross-site
form cannot act. The browser half polls the status route every 30 seconds and after every action.

## Verification (2026-11-06)

Verified live in the `web` profile:

- `npm run check` — 78 tests, 0 failures.
- Installed with the plugin manager: `application: applied`, no warnings.
- `vib_status` and `vib status` both report the three mounted bundles (`dsh-plugin-alerts`,
  `dsh-plugin-pixelart`, `dsh-plugin-viburnum`), each current, dot green.
- `GET /viburnum/status` returns `200` with the rows and config; the browser client had fetched it
  (`transport.clientSeenAt` with a Chrome user agent), so the page transport works end to end.
- Client slot inspection: `sidebar.panellist` occupant `viburnum` at `order: -10` before `plugins`
  (`order: 0`), and `main` occupant `viburnum` active.
- One live fetch hit the 20 s bound and was reported as a timeout without leaving a git process
  behind; `vib status` still answered from cache.

Not run, and therefore not claimed: visual checks in light and dark, the Chinese UI copy, an
approval prompt end to end (the answerer is disabled in this session), a real move on one of the
user's plugin checkouts, and the second machine.

## Limits

- Viburnum never commits and never force-pushes.
- 0.1.0 is accepted against offline fixture repositories. No second machine is available, so
  cross-machine sync is not verified in this release.
- The page transport is a localhost-only JSON route pair; it stores no credentials and reads no
  secrets. Git inherits whatever the machine already uses.
- Only `link:` and `file:` dependencies are watched. Registry bundles are the plugin manager's job.

## Branches

`main` is the **stable line**; `dev` is the **integration line** where work happens. Features use
`feature/<slug>` branches cut from `dev` and merged back into it; a `hotfix/<slug>` cuts from
`main`, merges into `main`, then merges back into `dev`. A release merges `dev` into `main` after
the full `check`, tags `v<version>`, and syncs `main` back into `dev`. The detailed rule lives in
the `dsh-plugin-development` skill.

House rules: private by default, MIT when it ships, `npm run check` is the gate, `node:*` before a
dependency, no telemetry, and the only writes are the profile state file and the checkouts the user
asked a move to touch.
