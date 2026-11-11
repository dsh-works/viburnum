# viburnum

*a manager that keeps all linked installs neatly synced in two universes.*

A workbench for your own DeepSeek Harness plugins: create them, mount them, choose which version runs,
and keep two machines in sync. It watches the clones your profile is linked to, and one click fetches,
pushes, fast-forwards or rebases each one onto the branch it follows — so both machines run the same code
without you remembering which one pushed last.

A row in the sidebar carries one dot: green when everything is current, violet when something can be
pulled, orange when work is uncommitted, red when it is unpushed or diverged. Installing from a
directory, a repository URL or a GitHub organisation is one action, from the page or `vib install`.

viburnum began as one person's two-machine workshop, and it is public now because that problem is not
unique to one person: everyone who develops a harness plugin on more than one machine has the same
"which checkout is current?" question. Named after the shrub that holds its berries through the
winter: in place, visible, current. The command is `vib`; `viburnum` works too.

```
laptop ⇄ origin ⇄ work machine
             one click: fetch → ff | rebase → push
```

Each bundle follows a **track** — `main`, or `dev` while you are trying something — and the track is
per machine, so the laptop can try `dev` while the work machine stays on `main`. Switching is the same
button with the other branch. An update is a fetch and a fast-forward in the linked directory, so
there is no pnpm run, no lockfile write, and no profile edit.

viburnum never commits and never force-pushes. When a rebase would rewrite something already
published, it stops and shows both sides; when the rebase conflicts, it aborts and hands you the files.

**Status: 0.3.0 released (tag `v0.3.0`), public under the MIT licence.**
[`docs/PLAN.md`](docs/PLAN.md) is the approved plan and carries the gate-3 evidence;
[`DESIGN.md`](DESIGN.md) carries the premise and decisions. `main` is the stable line (see
[Branches](#branches)).

## Public and open

- **[MIT licence](LICENSE).** Use it, fork it, ship it; no warranty.
- **Built against the public rulebook.** [dsh-plugin-development](https://github.com/dsh-works/dsh-plugin-development)
  is the skill and process this repository follows — plan gates, bundle shape, standards, templates and
  lessons. A process nobody can read is a rumour.
- **Contributions are welcome.** Read [CONTRIBUTING.md](CONTRIBUTING.md) first: work branches cut from
  `dev`, `npm run check` is the gate, and one change per pull request. Security reports go through
  [SECURITY.md](SECURITY.md), not public issues.
- **English first.** UI copy ships in English; another language is added only when the plugin
  actually ships one.
- **No telemetry, no network daemon, no account.** The only outbound traffic is git's own `fetch` and
  `push`, in the directories the profile already links.

## What viburnum does

- **One dot and the counts** in the sidebar, above Plugins: the worst state across every linked
  checkout — green current, violet pullable, orange uncommitted, red unpushed or diverged, grey
  unknown — plus the aggregate `↑ahead ↓behind` counts at the row's right edge.
- **The viburnum page**: the mounted checkouts with each plugin's icon, declared version, track,
  direction counts and directory, and `Refresh` / `Sync all` / `Install` / `Hygiene`. Clicking a row
  opens its workbench.
- **The workbench detail**: the branch as the hero control, the incoming changelog rendered as
  Markdown, target/current versions, the reload class, README and CHANGELOG inline, the folder opened
  in the desktop or a **Terminal** started in the checkout, and `Update` / `Sync` / `Revert` / track
  switch that re-fetch the detail after a move. A stopping conflict offers Agree / Guide / Myself.
- **Install doors**: **Directory** (with the Host's native folder picker), **Repository URL**, and
  **Organisation** (a cached, paginated, searchable list of the configured GitHub owners'
  repositories — private ones included when git has GitHub credentials stored on the machine — with
  icons, descriptions and an in-place README **Preview** before installing). Every install goes
  through `pluginManager.installBundle`; new clones land in the shelf (`pluginsDir`), while checkouts
  the profile already links are never moved.
- **Moves**: `Update` is a fetch and a fast-forward. `Sync` pushes unpublished commits, fast-forwards,
  or rebases private divergence and pushes it; it refuses to rebase published history, and a
  conflicting rebase **stays stopped** with three exits — **Agree** (union-merge append-only files),
  **Guide** (open the files, fix, Retry) and **Myself** (abort). `Revert` restores the latest update
  or switch snapshot.
- **Timeline**: what changed since the last look — incoming commits (with their first subject) and
  viburnum's own moves — above the rows; `vib log` reads and clears it.
- **Hygiene scan**: duplicate checkouts, local branches never merged into `main`, and dirty trees,
  each with a suggestion. It reports; it never deletes, moves or checks anything out. `vib hygiene`.
- **Settings → viburnum**: refresh interval, refresh on startup, the checkout directory
  (**Browse…** / **Use default**), the organisation list and its default organisation, the
  **terminal application** (Windows Terminal / PowerShell / iTerm2 / Terminal.app / x-terminal / GNOME
  / xterm, or automatic), a **Command line** card that reports whether the user's own shell finds
  `vib`, installs or removes our `npm link` after an in-page confirmation, and copies the PATH line or
  the direct `node bin/vib.js` command when the shell cannot see it, and harness-drift warnings. Saved
  in the profile state and applied without a reload.
- **Harness-drift tracking**: a warning when the running DSH version changes between runs, and one for
  every plugin whose `engines.dsh` range rejects the running harness.
- **Six model-facing tools**: `vib_status`, `vib_brief`, `vib_update`, `vib_sync`, `vib_switch`,
  `vib_revert`. Reads are free; every move asks for approval.
- **A CLI**: `vib status | refresh | update | sync | switch | revert | log | hygiene | brief | install | new`,
  plus `--json`, `--dry-run`, `vib sync --agree|--continue|--abort` and
  `vib new --push --org <owner>` (creates the GitHub repository and pushes the first commit). The page
  can put it on your PATH: **Settings → viburnum → Command line** reports where it resolves, runs the
  `npm link` install/remove after an in-page confirmation, and copies the fallback PATH line; a
  one-time notice points there while the command is missing.
- **State with the profile**: tracks, cached rows, receipts, snapshots, the timeline, the settings and
  the last seen harness version at `$DSH_HOME/profiles/<profile>/.viburnum/state.json`, written
  atomically and pruned on write.

## Install

The plugin is installed into a profile by the plugin manager, never by hand. Pass the absolute path
of the checkout on this machine:

```sh
# macOS / Linux
dsh plugin --profile web add ~/Documents/deepseek-harness/viburnum
```

```powershell
# Windows
dsh plugin --profile web add C:\Users\<you>\Documents\deepseek-harness\viburnum
```

The CLI needs `vib` on `PATH` only for terminal use:

```sh
# macOS / Linux
cd ~/Documents/deepseek-harness/viburnum && npm link
```

```powershell
# Windows
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
| `catalogOwners` | `['dsh-works']` | GitHub owners the organisation door reads. |
| `pluginsDir` | `''` | Shelf directory for new repository installs; empty means `$DSH_HOME/viburnum/plugins`. |

The **Settings → viburnum** page saves per-profile overrides in the state file for the check interval,
refresh-on-startup, version warnings and the checkout directory. Loader configuration stays the
deployment default; a saved setting takes precedence until it is changed again.

Invalid configuration fails the plugin load with the field and range named.

## The state file

`$DSH_HOME/profiles/<profile>/.viburnum/state.json` is owned by the plugin: `version: 3`, bundle
records (track, last check, cached row, `engines.dsh`), a 50-entry action history, 20 update/switch
snapshots kept for 30 days, a 50-event timeline with seen marks, the saved settings, and the last seen
harness version. The page, the tools and the CLI share it through the one core; writes are
temp-file + rename.

The page's data does not travel through a generated Remote endpoint — an out-of-tree bundle cannot add
one. It uses two same-origin JSON routes registered on the Host web server,
`/viburnum/status` and `/viburnum/action`, which require the `x-viburnum: 1` header so a cross-site
form cannot act. The browser half polls the status route every 30 seconds and after every action.

## Verification

### 0.3.0 verification (2026-11-11)

Verified on macOS (Darwin arm64, Node 24.21.0) in the `web` profile at release:

- `npm run check` — 161 tests, 0 failures; the GitHub Actions gate is green on ubuntu, macOS and
  windows.
- **Conflict exits and `vib_brief`**: Agree / Guide / Myself and the brief feed are covered by the
  fixture and tool tests; the live page panel was not re-exercised for this release.
- **Terminal opener**: the live Host action returned `opened: true` and a new shell whose working
  directory is the bundle checkout (verified with `lsof`, and by clicking **Terminal** in the
  workbench); iTerm2 and Terminal.app are opened through LaunchServices (`open -a`), replacing an
  AppleScript `command` that closed the iTerm2 session immediately.
- **Terminal application setting**: per-platform choices, preference ordering and validation are
  unit/route tested.
- **Repository creation**: verified live on 2026-11-11 — `vib new vib-smoke --push --org dsh-works`
  created a private `dsh-works/dsh-plugin-vib-smoke`, committed the scaffold and pushed it to `main`
  (the remote `main` SHA equalled the local `HEAD`), then printed the `vib install` next step; a
  second run of the same name was refused with `create-http` 422 and pushed nothing. The throwaway
  repository was left for the owner to delete
  ([dsh-plugin-vib-smoke](https://github.com/dsh-works/dsh-plugin-vib-smoke)). The "push fails after
  creation" path is still not run.
- **CLI on PATH**: verified live end to end — see [CLI on PATH](#cli-on-path-2026-11-10-dev).
- **Cross-platform**: the same suite runs on ubuntu, macOS and windows, and needs no machine git
  identity.

Not run, and therefore not claimed: a real install through each of the three doors, a live conflict
resolution in the page, and cross-machine sync.

### 0.2.0 verification (2026-11-09)

Verified live in the `web` profile for 0.2.0:

- `npm run check` — 121 tests, 0 failures.
- The page transport, sidebar row, icons, counts, workbench detail, inline Markdown README/CHANGELOG,
  install form (all three doors), Settings → viburnum, timeline feed and Hygiene panel were exercised
  in the running GUI; the visual pass was confirmed by the repository owner.
- The guarded routes were exercised directly: `detail`, `document`, `open` (folder accepted by the
  desktop), `install` refusals (`invalid-directory`, `missing-directory`, `already-installed`,
  `invalid-repository`), `catalog` (a live GitHub read of `dsh-works`), `timeline`, `hygiene`
  (10 checkouts, 8 findings), and `settings` (set/reset the checkout directory; a relative path
  refused).
- CLI: `vib log`, `vib hygiene` (exit 3 on findings), `vib install .` through the live Host
  (`already-installed` refusal), and `vib new` with its generated test passing.
- Harness drift: the running version was detected as `0.2.2-rc.1`; all mounted plugins accepted it.

Not claimed: a real install of a new plugin (the profile was not mutated for a test), a real track
switch from the live detail, light/dark theme comparison, and the second machine.

### Cross-platform check (2026-11-09, `dev`)

The macOS path was made verifiable while 0.3.0 was in flight:

- `npm run check` — 150 tests, 0 failures on macOS 26.7 (Darwin arm64, Node 24.21.0).
- CI runs the same gate on `ubuntu-latest`, `macos-latest` and `windows-latest` (Node 22), and all
  three are green at `c8b43fb`; the ubuntu and windows runs also prove the suite needs no machine git
  identity (it pins its own).
- The live CLI ran on this Mac: `vib status` (exit 3 while a row is not current) and `vib brief`
  (exit 0) both answered from the real profile.
- The terminal command builder describes all three platforms from one Host (`wt.exe`/`powershell.exe`,
  LaunchServices `open -a iTerm`/`iTerm2`/`Terminal`, `x-terminal-emulator`/`gnome-terminal`/`xterm`),
  passes the checkout as one launch argument, and falls through a launcher that exits non-zero
  instead of reporting a false success. The Linux directory picker falls back to `kdialog` when
  `zenity` is absent; all of this is covered by unit tests with an injected spawn.

The live Terminal action was verified after a later reload (see 0.3.0 verification).

### CLI on PATH (2026-11-10, `dev`)

- `npm run check` — 161 tests, 0 failures; the 11 new CLI-path tests cover detection, shim
  ownership, install/remove and the Windows command shapes.
- CI — the full gate is green on ubuntu, macOS and windows at `b46189f`.
- Live, after the profile reload, in the running GUI (light and dark): the missing state and the
  one-time notice rendered; **Later** hid the notice for that page load and it returned after a
  reload; **Install it → Run** ran `npm link`, the notice disappeared, and the card showed
  **✓ Available at `/Users/vanish/.nvm/…/bin/vib`** with Check again, the direct command and Copy.
  `command -v vib` then resolved in zsh, bash and sh, and `vib --help` ran.
- Negative control: the `cli` install action without `confirm: true` is refused with
  `confirmation-required`.
- Remove verified live after the next reload: **Remove → confirm → Run** removed the link
  (`command -v vib` gone in zsh, bash and sh, and the card returned to "not on your PATH"), then
  **Install → Run** restored it with `owned: true`. The ownership bug this exposed — the check read
  `<prefix>/node_modules` instead of npm's POSIX global root `<prefix>/lib/node_modules` — is fixed
  in `92ccd2c`.

### 0.1.0 verification (2026-11-06)

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

Not run, and therefore not claimed: visual checks in light and dark, an approval prompt end to
end (the answerer is disabled in this session), a real move on a user checkout, and the second
machine.

## Limits

- viburnum never commits and never force-pushes.
- Installing the `vib` command runs `npm link` in this checkout after an in-page confirmation; it
  writes only into npm's global bin, and the link belongs to the active Node version (after an nvm
  version switch, install again). Page buttons do not use the harness approval service — that service
  is turn-bound, so a browser click cannot route a decision through it.
- The desktop actions are OS-native: the terminal comes from the platform's candidate list (Windows
  Terminal/PowerShell, iTerm2/Terminal.app through LaunchServices, x-terminal/gnome-terminal/xterm),
  **Browse** needs `zenity` or `kdialog` on Linux, and `vib new --push` needs git 2.28 or newer
  (`git init -b`).
- 0.3.0 is accepted against the live local profile and offline fixture repositories. No second
  machine is available, so cross-machine sync is not verified in this release.
- The page transport is a localhost-only JSON route pair; it stores no credentials and reads no
  secrets. Git inherits whatever the machine already uses.
- Only `link:` and `file:` dependencies are watched. Registry bundles are the plugin manager's job.

## Branches

`main` is the **stable line**; `dev` is the **integration line** where work happens. Features use
`feature/<slug>` branches cut from `dev` and merged back into it; a `hotfix/<slug>` cuts from
`main`, merges into `main`, then merges back into `dev`. A release merges `dev` into `main` after
the full `check`, tags `v<version>`, and syncs `main` back into `dev`. The detailed rule lives in
the `dsh-plugin-development` skill.

## Licence

MIT — see [LICENSE](LICENSE). The candidate butterfly marks in [`icons/`](icons/) came from the
design notebook and are part of the repository; the eventual shipped mark will be chosen there.

House rules: `npm run check` is the gate, `node:*` before a dependency, no telemetry, and the only
writes are the profile state file and the checkouts the user asked a move to touch.
