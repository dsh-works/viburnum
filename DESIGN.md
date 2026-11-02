# PAM — plugin auto manager

**Status:** design, revision 2, v0 not started
**Date:** 2026-11-02
**Package:** `dsh-plugin-pam` · row `pam` · panel `pam`
**Repo:** [`dsh-works/pam`](https://github.com/dsh-works/pam)

> Revision 2 folds in the premise that decides most of the design: PAM is built by its only user, for
> that user's own plugins. Three repositories today, more later; a laptop that writes and a work
> machine that reads. Generality is a tax this tool declines to pay.

---

## 1. The problem

Two machines, one person, three plugins.

On the laptop: edit, commit, push. On the work machine the next morning: run the harness and hope it
is last night's version. Nothing in the profile says it is not — it stores
`link:C:/…/dsh-pixelart-tool`, not a commit. So the distance between "what I wrote" and "what is
running" is invisible until it bites.

Three bites, in the order they actually happen:

1. **The missing push.** A night's work stays on the laptop; the work machine pulls nothing and
   silently runs Thursday's code. The two machines then disagree about "latest", and the versions in
   `package.json` disagree with the behavior.
2. **No channels.** `main` is what should run; a `dev` branch is what is being tried. Moving between
   them today is `git switch` in a directory you have to remember, then a restart.
3. **Adoption is manual.** A new plugin means cloning it somewhere, hand-editing the profile's
   dependencies, and remembering the path — the one part of the loop with no button.

None of the three bundles has a tag (checked 2026-11-02), so a tag-watcher would watch nothing.
Branches are the real channels here, and they already exist.

## 2. Thesis

**PAM is a pull button for code you wrote.**

```
laptop                                    work machine
edit → commit → push    ────────────────▶  Update all → fetch → fast-forward → reload
                                           (PAM never pushes; it only pulls)
```

Four properties, in the order they matter to the only user:

1. **One click, everything current.** `Update all` brings every watched checkout to the head of its
   track. No per-plugin decisions when there is nothing to decide.
2. **Hot swap.** Any bundle moves between `main` and `dev` as one action, and the row shows both heads
   before you do it.
3. **Direction honesty.** *Behind* is an update. *Ahead* is an unpushed night — PAM says so, clearly,
   and touches nothing. It cannot push, so the warning is the entire fix it can offer.
4. **Cheap.** An update is a fetch and a fast-forward in one directory: no pnpm, no lockfile, no
   profile write. Seconds, not a coffee.

## 3. The model: tracks, not tags

Each watched bundle has a **track**: the branch it follows. `main` by default, `dev` when trying
something. The track lives in PAM's state — not in the repository, not in the profile.

| Term | Meaning |
| :--- | :--- |
| **track** | The branch a bundle follows: `main`, `dev`, any branch the remote has. |
| **current** | `HEAD` is on the track and equals `origin/<track>`, tree clean. |
| **behind** | `HEAD` is an ancestor of `origin/<track>`: one fast-forward away. |
| **ahead** | `HEAD` has commits `origin/<track>` does not. Unpushed work. Never touched. |
| **diverged** | Both moved. Needs a human and a rebase; PAM reports and stops. |
| **dirty** | Uncommitted changes. Blocks update and switch. |
| **detached** | No branch. Blocks update; offers the branches to switch to. |
| **local-only** | No `origin`. Visible, never updatable. |

Tags are still read, but only as a label beside the commit: `main · v1.3.0 · 8c1de02`. A repository
without tags is normal, not a problem to solve.

## 4. Decisions

| #   | Decision | Consequence |
| --- | --- | --- |
| D1  | **Watch, update, switch, adopt.** Installing delegates to `plugin_manager.installBundle`; PAM never runs a package manager. | PAM stays small and cannot corrupt a profile's dependency graph. Adoption inherits every check the manager already does. |
| D2  | **The track is the unit.** Per bundle, with `all to main` / `all to dev` as bulk helpers. | Mixed tracks are the normal state: two plugins on `main`, the one you are poking on `dev`. |
| D3  | **Update is fast-forward only.** No rebase, no force, no detached checkout. | An update can never rewrite the work machine's history or lose a commit. Diverged stops for a human. |
| D4  | **Dirty blocks both update and switch.** No automatic stash. | The one irreversible mistake this tool could make is never available to it. The UI prints the `git stash` to run. |
| D5  | **Snapshot before every update and switch; Revert restores it.** | Undo works even after the restart that revealed the problem. A switch is a receipt too, so "what was I on before dev?" is answerable. |
| D6  | **Compatibility is shown and blocks unless forced.** `engines.dsh` and DSH peers of the target commit. | A `dev` branch that needs a newer harness is refused before the tree moves, with `--force` for the deliberate case. |
| D7  | **Checks automatic, updates on click.** Start plus `checkIntervalMinutes`. `autoUpdateOnStart` exists, default off. | The page is right when opened; nothing installs while you are not looking. Turning it on later is a config field, not a redesign. |
| D8  | **One core, three faces.** Host service, Web page, tools, CLI binary. | The page is the default; the tools and CLI are the same calls with a different keyboard. |
| D9  | **State with the profile**, `$DSH_HOME/profiles/<name>/.pam/`. Never in a bundle repo. | `git status` in any plugin stays clean; no profile's history leaks into another. |
| D10 | **PAM updates itself separately.** `Update all` skips its own row; `Update PAM` moves the files and says restart. | The one tool that must not be stale gets updated, without pretending the running code changed. |
| D11 | **Install is adoption.** Pick a directory, validate it is a bundle, hand it to `installBundle`, set its track to the branch it is on. | A new plugin is two clicks and lands in the same table as the rest. |
| D12 | **PAM never pushes and never touches credentials.** It inherits git's auth and reports its failures. | No token handling, no accidental push from the wrong machine. |
| D13 | **Two machines, one writer.** The work machine consumes; local commits there are surfaced, not merged. | The asymmetry is honest instead of pretending both ends are equal. |
| D14 | **Tests are offline.** Fixtures are real repositories: a bare `origin` in a temp dir, cloned, branched, committed. | Fetch, fast-forward, divergence and switch are all exercised without network. |

## 5. Surfaces

### 5.1 Web page — "Updates"

Registered like the Plugins page: a keyed `main` panel with id `pam` and a `sidebar.panellist` entry,
selected through `ctx.layout.selectPanel('pam')`.

- **Header:** `Check`, `Update all`, `Install from directory…`, and "checked 3 minutes ago".
- **Table:** bundle, track (`main` / `dev` toggle per row), current, direction (`behind 2`, `ahead 3`,
  `diverged`), last checked. Three rows today; the list is not paginated and does not need to be.
- **Detail:** changelog between `HEAD` and the target, commit list when there is no changelog, the
  version drift note (below), the compatibility verdict, and `Update` / `Switch track` / `Revert`.
- **Version drift:** `v1.3.0 unchanged across 12 commits` — the `package.json` version did not move
  while the code did. Not an error; the cheapest possible reminder for "version mismatch".
- **After an action:** one banner naming what changed and what it needs — *browser half, refresh the
  page* · *host half, restart `dsh web`* · *both*.
- **Ahead rows:** a visible warning, on the machine that can fix it: *3 commits not on `origin/main`
  — push from the laptop before you leave.*

### 5.2 Agent tools

| Tool | Arguments | Behavior |
| :--- | :--- | :--- |
| `pam_status` | — | Cached rows. No network, no writes. |
| `pam_update` | `bundle?`, `fetch?` | One bundle, or all when omitted. Snapshot, gate, fast-forward, receipt. Needs approval: it writes outside the workspace. |
| `pam_switch` | `bundle`, `track` | Same gate and receipt, different move. Needs approval. |
| `pam_install` | `path` | Validates the directory, then `installBundle`. Needs approval. |
| `pam_revert` | `bundle` | Restores the last receipt. Needs approval. |

Same shape as the house tools: `buildTools()` in `lib/tools.js`, plus one system-prompt sentence so
the model proposes `pam_update` instead of hand-editing a `link:` path.

### 5.3 CLI

`dsh plugin` forwards to pnpm, so there is no supported `dsh pam` subcommand to hook. v0 ships a `pam`
binary:

```
pam status [--json]
pam update [<bundle>] [--fetch]
pam switch <bundle> <track>
pam install <dir>
pam revert <bundle>
pam log [--limit 20]
```

Exit codes: `0` success, `1` failure, `3` updates available from `status`/`update --check`. If DSH
grows a command-extension point, the binary becomes a wrapper around the same service.

## 6. How it works

### 6.1 Check

```text
bundles = pluginManager.listBundles()
for each bundle with source =~ /^(link|file):/
  dir  = absolute path from source
  skip when the directory, or dir/.git, is missing        → "not watched"
  branch = git rev-parse --abbrev-ref HEAD                 (HEAD = detached)
  head   = git rev-parse HEAD
  dirty  = git status --porcelain is non-empty
  fetch  = git fetch --prune --tags origin                 (timeout, no prompts, no shell)
  track  = state.track or branch or "main"
  counts = git rev-list --left-right --count origin/<track>...HEAD
  ahead, behind = counts
  status = dirty | detached | diverged | ahead | behind | current
  tracks = git branch -r --format='%(refname:short)'        for the switcher
  changelog = see 6.6
```

Bundles are checked in parallel, at most three git processes at a time. A bundle whose fetch fails
keeps its previous row with a stale timestamp instead of disappearing.

### 6.2 Update one

1. Re-read: still clean, still on the track, still at the commit the user saw.
2. `git merge --ff-only origin/<track>` — refuses anything but a fast-forward.
3. Verify `HEAD` is the expected commit and `package.json` parses.
4. Write the receipt (previous commit, branch, profile-file copies), report the reload class.
5. Steps 2–3 are transactional: a failure returns to the previous commit, keeps no receipt.

An update never switches branches and never detaches. If the clone is on `dev` while the track says
`main`, that is a *switch*, not an update — PAM refuses and offers the switch.

### 6.3 Update all

Sequential, one bundle at a time, continuing past a blocked row. The summary is one sentence plus
one line of reload advice:

```
3 updated · 1 blocked (dirty) · restart dsh web
```

Nothing is ever updated from a background timer; "all" is still a click (D7).

### 6.4 Switch track

1. `git fetch --prune origin`.
2. `git switch <track>`; when the branch does not exist locally, `git switch -c <track> --track origin/<track>`.
3. Fast-forward it, exactly as 6.2.
4. Receipt: from `main@8c1de02` to `dev@4f2a91c`, reload class between the two heads.

A switch is the inverse of itself: the same action with the other track. That is the "hot swap".

### 6.5 Install from directory

1. `ctx.directoryPicker`: `native.pick()` when the capability is native, otherwise the browse flow.
2. Validate: `package.json` exists and declares `dsh.bundle.patch`; refuse a directory that is not a bundle.
3. `pluginManager.installBundle(absoluteDir)` — the manager runs pnpm, selects the bundle, and applies
   its compatibility checks. PAM reports the result verbatim.
4. Set the track from the directory's current branch when it is a git checkout; otherwise `local-only`.
5. The new row appears without a restart when HMR is on; otherwise the manager's `restart-required`
   is passed through.

### 6.6 Changelog and reload class

Changelog, first hit wins: `git show <target>:CHANGELOG.md` section whose heading names the version →
the file's first section → `git log --no-merges --format='%h %s' <from>..<to>` → the target commit's
subject. Capped at 16 KB, plain text, no HTML. Missing changelog is a row, not an error.

Reload class from `git diff --name-only <from>..<to>`:

| Changed paths | Message |
| :--- | :--- |
| `client*.js`, `lib/client*`, `locale/**` | Browser half — refresh the page. |
| `index.js`, `lib/**` | Host half — restart `dsh web`. |
| `package.json` dependencies | Also: dependencies changed; the install is yours. |
| anything else | No reload needed. |

With HMR on, DSH may recompose by itself; the banner stays, because "probably live" is not a promise
this plugin should make until **O1** is answered.

## 7. State

`$DSH_HOME/profiles/<name>/.pam/state.json`:

```jsonc
{
  "version": 1,
  "bundles": {
    "dsh-plugin-pixelart": {
      "track": "dev",
      "lastCheck": "2026-11-02T16:40:00Z",
      "dir": "C:/Users/…/dsh-pixelart-tool",
      "head": "4f2a91c",
      "branch": "dev",
      "status": "behind",
      "ahead": 0,
      "behind": 2,
      "target": "8c1de02",
      "changelog": "…",
      "error": null
    }
  },
  "history": [
    {
      "bundle": "dsh-plugin-alerts",
      "at": "2026-11-01T09:12:00Z",
      "kind": "update",
      "from": { "branch": "main", "sha": "a1b2c3d" },
      "to": { "branch": "main", "sha": "e4f5a6b" },
      "result": "applied",
      "snapshot": "2026-11-01T09-12-00-dsh-plugin-alerts.json"
    }
  ]
}
```

Snapshots sit beside it in `.pam/snapshots/` with copies of `package.json`, `cordis.patch.yml` and
`compatibility.json`. Retention: 50 history entries, 20 snapshots, 30 days. Atomic writes (temp +
rename), because the page and the tools may touch it at once.

## 8. Failure modes

| Failure | What PAM does |
| :--- | :--- |
| Offline / fetch times out | Keeps the previous row, marks it stale, no dialog. |
| Remote needs auth | Same as offline, quoting git's error once. Credentials are git's business. |
| Dirty tree | Blocks update and switch; shows the `git stash` and the diff stat. |
| Ahead of origin | Warns, names the commit count, refuses to update. Nothing to pull. |
| Diverged | Refuses, shows the two counts, points at a rebase. |
| Detached head | Blocks update, lists the local and remote branches it can switch to. |
| `engines.dsh` unmet | Blocks before the move, names both versions; `--force` for the deliberate case. |
| Directory moved or deleted | Row becomes `missing`; update, switch and revert refuse. |
| No `origin` | `local-only`: visible, never updatable. |
| Install target is not a bundle | Refused before pnpm runs, with the missing `dsh.bundle.patch`. |
| Install target already installed | Passed through as the manager's `already-installed`. |
| Apply fails midway | Returns to the previous commit, no receipt, error surfaced. |
| Two actions at once | One in-process queue per bundle; a second request waits. |
| Profile dir not writable | Checks still run in memory; updates refuse with the path. |

## 9. v0 cut — 0.1.0

Ships: one profile, `link:`/`file:` bundles, tracks, check, changelog, compatibility, `Update all`,
per-bundle update, track switch, revert, the Updates page, `pam_status`/`pam_update`/`pam_switch`/
`pam_revert`, the `pam` CLI, offline tests.

Follows immediately (0.1.x): `pam_install` and the directory picker, `autoUpdateOnStart`, `pam log`.

Not planned: registry bundles, auto-apply timers, push, credentials, multi-profile, notifications,
diff stat, dependency installation, Windows tray integration.

Build order, each step ending at a green `npm run check`:

1. Fixture repositories + `lib/git.js` + `lib/version.js` — inspect, counts, changelog.
2. `lib/check.js` against a stubbed `pluginManager`; state read and write.
3. `pam status` / `pam update` — the morning workflow, working before there is a page.
4. Update-all, transactions, receipts, `pam revert`.
5. Track switch.
6. Web page, sidebar entry, reload banner.
7. Agent tools.
8. Directory picker and adoption.

## 10. Open questions

- **O1 — does HMR recompose a linked bundle when its directory changes?** One throwaway commit in a
  linked clone answers it; the banner wording depends on the answer.
- **O2 — how does a host plugin learn the profile directory?** `plugin_manager` reads launcher facts;
  if there is no public accessor, state moves to `$DSH_HOME/pam/<profile>/`.
- **O3 — does the work machine ever get local commits?** v0 assumes no, and surfaces them if yes. If
  that is wrong, D3 needs a pull-with-rebase story.
- **O4 — `autoUpdateOnStart` default.** Off now, because a broken `dev` branch should not greet you at
  start; revisit once switching feels routine.
- **O5 — version bumping.** Should `pam bump <bundle>` write the next `package.json` version from the
  changelog, so the drift note stops appearing? A stretch goal, not v0.

## 11. House conventions

Package `dsh-plugin-pam`, private, MIT when it ships, `engines` floor `dsh ^0.2.1-rc.2`, `node >=22`.
Layout follows the workshop: `index.js`, `lib/`, `client.js`, `client.*.js`, `cordis.patch.yml`,
`test/`, `scripts/check.mjs`, `README.md`. No runtime dependencies beyond `node:*`; every git call is
a `spawn` with an explicit cwd, a timeout and `GIT_TERMINAL_PROMPT=0`. The README's **Limits** section
opens with the fact that PAM cannot push.
