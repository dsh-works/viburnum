# PAM — plugin auto manager

**Status:** design, revision 3, v0 not started
**Date:** 2026-11-03
**Package:** `dsh-plugin-pam` · row `pam` · panel `pam`
**Repo:** [`dsh-works/pam`](https://github.com/dsh-works/pam)

> Revision 3 fixes the premise that matters most: **both machines write.** Revision 2 assumed a laptop
> that produces and a work machine that consumes. It does not. Both are checkout-and-commit machines,
> so the action is not "pull" — it is "reconcile", in both directions, without losing a commit.

---

## 1. The problem

Two machines, one person, three plugins, and both machines are development machines.

The profile stores `link:C:/…/dsh-pixelart-tool`, not a commit. So "is this the version I fixed last
night?" has no answer inside the harness. Worse, with two writers it is the wrong question: the real
one is **which machine is ahead, and in which direction**.

What actually goes wrong:

1. **Unpushed nights.** Commits sit on the laptop; the work machine pulls nothing and runs Thursday's
   code. The `package.json` version agrees with neither machine's behavior. This is the "version
   mismatch" — two histories that were never reconciled, wearing the same number.
2. **Divergence.** Both machines committed from the same base. Neither can fast-forward, and the fix
   is a rebase onto the other machine's work — a command to remember, in three directories.
3. **Channels.** `main` is what should run; `dev` is what is being tried. One machine may want `dev`
   while the other stays on `main`, and moving between them today is manual.
4. **Adoption.** A new plugin means cloning, hand-editing the profile, remembering the path.

None of the three bundles has a tag (checked 2026-11-02), so tags are not the mechanism. Branches are,
and divergence is normal rather than exceptional.

## 2. Thesis

**PAM is a sync button for code you wrote.**

```
      laptop ⇄ origin ⇄ work machine        both commit, both push, both pull
                     │
           one click: fetch → ff | rebase → push → reload
```

Four properties, in the order they matter to the only user:

1. **One button, both directions.** `Sync all` pushes what this machine has, takes what the other
   machine pushed, and reconciles the middle — with a sentence that says how many commits moved each
   way.
2. **Hot swap.** Any bundle moves between `main` and `dev` as one action. The track is per machine, so
   the laptop can live on `dev` while the work machine stays on `main`; switching is how they agree.
3. **Safe by construction.** PAM never commits, never force-pushes, never rebases a published commit
   onto a rewritten base, and aborts a conflicting rebase rather than leaving a half-finished one.
4. **Cheap and legible.** An update is a fetch and a fast-forward; a sync adds a push and, at worst, a
   rebase. Seconds, and every step is a git command he could have typed — which is the point.

This is a wheel. It is being reinvented on purpose, in the one place where the wheel covers his own
three plugins, and where the reinvented one can say "two commits on `dev` are not on `origin/dev`
yet" in a sentence git does not have.

## 3. The model: tracks and directions

Each bundle has a **track**: the branch it follows on this machine. `main` by default, `dev` while
trying something. The track lives in PAM's state, per machine — not in the repository, not in the
profile.

| Term | Meaning |
| :--- | :--- |
| **track** | Branch this bundle follows here: `main`, `dev`, anything the remote has. |
| **current** | `HEAD == origin/<track>`, tree clean. |
| **local ahead** | Commits here that the remote does not have: a push away. |
| **remote ahead** | Commits on the remote: a fast-forward away. |
| **diverged** | Both. A rebase — or a refusal, when that rebase would rewrite published history. |
| **dirty** | Uncommitted changes. Blocks update, sync and switch. |
| **detached** | No branch. Blocks sync; offers the branches it can switch to. |
| **local-only** | No `origin`. Visible, never syncable. |
| **rebase in progress** | Someone started a rebase. PAM stops and says so. |

The safety predicate that decides diverged cases: **are the local-ahead commits already published?**
If yes, rebasing them would rewrite shared history and need a force-push — PAM refuses and says "merge,
or resolve by hand". If no, the rebase is a private rewrite and safe.

## 4. Decisions

| #   | Decision | Consequence |
| --- | --- | --- |
| D1  | **Watch, update, sync, switch, adopt.** Installing delegates to `plugin_manager.installBundle`; PAM never runs a package manager. | PAM stays small and cannot corrupt a profile's dependency graph. |
| D2  | **The track is the unit, per machine.** Bulk helpers move everything to `main` or `dev`. | Different tracks per machine are normal; that is what "trying something on the laptop" looks like. |
| D3  | **Update is fast-forward only.** No rebase, no force, no detached checkout. | Pulling never rewrites anything. |
| D4  | **Sync pushes, reconciles, and pushes again when the rebase moved something.** | The morning button closes the loop in both directions. |
| D5  | **Sync never commits and never force-pushes.** A dirty tree blocks it. | PAM cannot invent a commit message or overwrite a remote. |
| D6  | **Rebase only when the local commits are unpublished.** Published divergence is refused, with both commit lists shown. | No rewriting history two machines already saw. |
| D7  | **A conflicting rebase is aborted, not left open.** PAM lists the files and the retry command. | The tree always ends in a state git understands and the user chose. |
| D8  | **Snapshot for update and switch; audit for sync.** Revert restores a pull or a track move, never a pushed rebase. | Undo is honest about which actions are local-only. |
| D9  | **Checks automatic, actions on click.** `autoUpdateOnStart` exists, default off. | Nothing moves while you are not looking. |
| D10 | **One core, three faces.** Host service, Web page, tools, CLI binary. | Same calls, different keyboards. |
| D11 | **State with the profile**, `$DSH_HOME/profiles/<name>/.pam/`. Never in a bundle repo. | `git status` in any plugin stays clean. |
| D12 | **PAM updates itself separately.** `Sync all` skips its own row; `Update PAM` moves the files and says restart. | The tool that must not be stale gets updated honestly. |
| D13 | **Install is adoption.** Directory picker → validate → `installBundle` → track from the branch it is on. | A new plugin is two clicks and lands in the same table. |
| D14 | **Tests are offline.** Fixtures are real repositories: a bare `origin`, two clones, commits on both sides. | Divergence, rebase and conflict are exercised without network. |

## 5. Surfaces

### 5.1 Web page — "Updates"

Registered like the Plugins page: a keyed `main` panel with id `pam` and a `sidebar.panellist` entry,
selected through `ctx.layout.selectPanel('pam')`.

```text
Updates                                    [ Sync all ]  [ Check ]  [ Install from directory… ]
2 watched · checked 2 minutes ago

  Pixel Art      main                     v0.3.0 · 33903c8          ✓ in sync
                 dsh-pixelart-tool · dev +12 (v0.4.0)
  Alerts         feature/subagents-cost…  v0.4.0 · 3c69dc8          ✓ in sync
                 dsh-plugin-alerts · main +1
```

- **The second line is the directory**, because the package name lies: the profile links
  `dsh-pixelart-tool`, while `dsh-plugin-pixelart` sits beside it on another branch at another
  version. The path is the only honest identifier, so it stays visible.
- **The branch is the version selector**, not a `main`/`dev` toggle. A picker lists local and remote
  branches with `+N` counts against the current head; `main` and `dev` are promoted to chips. Any
  branch is a track, including `feature/subagents-cost-final`.
- **Direction, not status.** `↑2` is a push, `↓3` is a pull, `↑2 ↓3` is a rebase, `✓` is nothing.
  There is no word like "outdated", because it does not say what will happen.
- **Rows expand in place**, no separate detail pane: both commit lists when diverged, the changelog for
  the incoming side, the version drift note, the compatibility verdict, and the actions.
- **Version drift:** `v1.3.0 unchanged across 12 commits` — the cheapest reminder for the mismatch
  that started all this.
- **After an action:** one banner: *pushed 2, pulled 3, rebased 0 · restart `dsh web`* — or *conflict
  in 2 files: `lib/png.js`, `client.panel.js` — rebase aborted*.

### 5.2 Agent tools

| Tool | Arguments | Behavior |
| :--- | :--- | :--- |
| `pam_status` | — | Cached rows and directions. No network, no writes. |
| `pam_update` | `bundle?` | Fast-forward only. Snapshot, gate, receipt. Needs approval: writes outside the workspace. |
| `pam_sync` | `bundle?` | Fetch, push, reconcile, push. Audit entry. Needs approval. |
| `pam_switch` | `bundle`, `track` | Same gate and receipt, different move. Needs approval. |
| `pam_install` | `path` | Validate, then `installBundle`. Needs approval. |
| `pam_revert` | `bundle` | Restores an update or switch receipt. Needs approval. |

A routing sentence in the system prompt so the model proposes `pam_sync` instead of hand-editing a
`link:` path or running `git push` inside a plugin directory.

### 5.3 CLI

`dsh plugin` forwards to pnpm, so there is no supported `dsh pam` subcommand. v0 ships a `pam` binary:

```
pam status [--json]
pam update [<bundle>]
pam sync [<bundle>] [--dry-run]
pam switch <bundle> <track>
pam install <dir>
pam revert <bundle>
pam log [--limit 20]
```

Exit codes: `0` success, `1` failure, `3` something is pending (updates or unpushed commits).
`--dry-run` prints the reconciliation plan and touches nothing.

### 5.4 Two journeys

**A switch, with today's numbers.** Pixel Art's row reads `main · v0.3.0 · ✓`, with `dev +12 (v0.4.0)`
underneath. Clicking `dev` asks nothing — it is reversible by clicking `main`. The row shows
`switching…`, then `dev · v0.4.0 · ✓`; the expanded row shows the 0.3.0 → 0.4.0 changelog and the
banner says *on dev · host half changed — restart `dsh web`*. The version the org profile already
advertises is now the version running.

**A morning.** Two rows show `↓3` and `↓2`. `Sync all` works through them in order, each row reporting
its own step — `fetching…`, `fast-forward 3`, `push 1`, `rebase 2` — and a blocked row never stops the
next one. The banner at the end is the whole report: *pushed 1, pulled 5, rebased 0 · restart `dsh
web`*. Nothing is modal, nothing blocks the page, and the harness stays usable throughout.

**When it cannot.** Four sentences, never a spinner:

| State | The page says |
| :--- | :--- |
| dirty | *3 uncommitted files — commit or stash first* (with the command) |
| diverged, published | *2 commits here are already on `origin/main` — merge instead of rebase* |
| conflict | *rebase aborted · 2 files: `lib/png.js`, `client.panel.js`* (with the retry command) |
| auth | git's own sentence, quoted once, no retry loop |

## 6. How it works

### 6.1 Check

```text
for each watched bundle (parallel, at most 3 git processes)
  dir    = absolute path from pluginManager.listBundles().source
  skip when the directory, or dir/.git, is missing     → "not watched"
  branch = git rev-parse --abbrev-ref HEAD              (HEAD = detached)
  head   = git rev-parse HEAD
  dirty  = git status --porcelain is non-empty
  fetch  = git fetch --prune --tags origin              (timeout, no prompts, no shell)
  track  = state.track or branch or "main"
  counts = git rev-list --left-right --count origin/<track>...HEAD
  behind, ahead = counts
  hashes = git rev-list origin/<track>..HEAD            the "yours" list
           git rev-list HEAD..origin/<track>            the "theirs" list
  status = dirty | detached | rebasing | diverged | local-ahead | remote-ahead | current
```

A failed fetch keeps the previous row, marked stale, with git's error quoted once.

### 6.2 Update (pull only)

`git merge --ff-only origin/<track>`. Refuses when not fast-forwardable, and refuses when the clone is
not on the track (that is a switch, not an update). Snapshot before, receipt after, transactional
switch-back on a verification failure.

### 6.3 Sync

```text
1  refuse if dirty, detached, or a rebase is already in progress
2  git fetch --prune origin
3  counts = git rev-list --left-right --count origin/<track>...HEAD
4  if ahead == 0 and behind == 0        → nothing to do
5  if behind == 0                       → git push origin HEAD:<track>          (published, done)
6  if ahead == 0                        → git merge --ff-only origin/<track>   (pulled, done)
7  diverged:
     published = any commit in origin/<track>..HEAD is contained in a remote ref
     if published                       → refuse; show both lists; suggest a merge
     git rebase origin/<track>
       on conflict → git diff --name-only --diff-filter=U
                     git rebase --abort
                     report the files and the exact retry command
     git push origin HEAD:<track>       (non-force; a rejection is reported, never retried with force)
8  receipt: pushed N, pulled M, rebased R, previous and resulting HEAD
```

Pushing is the one thing revision 2 forbade. It is still never automatic, never forced, and never a
place where a credential is read: `git push` inherits whatever the machine already uses, and an auth
failure is a reported failure with a timeout.

### 6.4 Switch track

`git fetch`, then `git switch <track>` (`-c <track> --track origin/<track>` when the branch is new
locally), then fast-forward, then a receipt with both heads and the reload class between them. A
switch is its own inverse: the same action with the other track.

### 6.5 Install from directory

`ctx.directoryPicker` (`native.pick()` or the browse flow) → validate `package.json` declares
`dsh.bundle.patch` → `pluginManager.installBundle(absoluteDir)` → set the track from the checkout's
current branch → the row appears. The manager owns pnpm, bundle selection, and compatibility; PAM
reports its answer verbatim.

### 6.6 Changelog and reload class

Changelog, first hit wins: `git show <target>:CHANGELOG.md` section naming the version → the file's
first section → `git log --no-merges --format='%h %s' <from>..<to>` → the target subject. Capped at
16 KB, plain text. Missing changelog is a row, not an error.

Reload class from `git diff --name-only <from>..<to>`: `client*.js` / `lib/client*` / `locale/**` →
*browser half, refresh the page*; `index.js` / `lib/**` → *host half, restart `dsh web`*;
`package.json` dependencies → *also: dependencies changed*; anything else → no reload.

### 6.7 What the buttons actually run

Kept here because the point is to learn the commands, not to hide them.

| Button | Commands |
| :--- | :--- |
| Check | `git fetch --prune --tags origin`, `git rev-list --left-right --count origin/<t>...HEAD`, `git status --porcelain` |
| Update | `git merge --ff-only origin/<t>` |
| Sync | steps 2–7 above: `git push`, `git merge --ff-only`, or `git rebase` + `git push` |
| Switch | `git switch <t>`, `git merge --ff-only origin/<t>` |
| Revert | `git switch <branch>`, `git reset --hard <recorded-sha>` |
| Install | `pluginManager.installBundle(<dir>)` (pnpm runs inside the manager) |

## 7. State

`$DSH_HOME/profiles/<name>/.pam/state.json`:

```jsonc
{
  "version": 2,
  "bundles": {
    "dsh-plugin-pixelart": {
      "track": "dev",
      "lastCheck": "2026-11-03T08:40:00Z",
      "dir": "C:/Users/…/dsh-pixelart-tool",
      "head": "4f2a91c",
      "branch": "dev",
      "status": "diverged",
      "ahead": 2,
      "behind": 3,
      "theirs": ["8c1de02", "91ab3f0", "22d1c4a"],
      "changelog": "…",
      "error": null
    }
  },
  "history": [
    {
      "bundle": "dsh-plugin-alerts",
      "at": "2026-11-03T08:41:00Z",
      "kind": "sync",
      "from": "a1b2c3d",
      "to": "e4f5a6b",
      "pushed": 0,
      "pulled": 3,
      "rebased": 0,
      "result": "applied"
    }
  ]
}
```

Retention: 50 history entries, 20 snapshots, 30 days. Atomic writes (temp + rename), because the page
and the tools may touch it at once.

## 8. Failure modes

| Failure | What PAM does |
| :--- | :--- |
| Offline / fetch times out | Keeps the previous row, marks it stale, no dialog. |
| Push rejected (non-fast-forward) | Reports it, shows both lists, never retries with force. |
| Auth required | Fails with git's message and a timeout; credentials stay git's business. |
| Dirty tree | Blocks update, sync and switch; prints the `git stash` and diff stat. |
| Diverged, local commits published | Refuses; suggests a merge; lists the commits. |
| Diverged, local commits private | Rebases, then pushes. |
| Rebase conflict | Lists conflicted files, aborts the rebase, prints the retry command. |
| Rebase already in progress | Stops; names the directory and the command to finish or abort it. |
| Detached head | Blocks sync; lists the branches it can switch to. |
| `engines.dsh` unmet | Blocks before the move, names both versions; `--force` for the deliberate case. |
| Directory missing / no `origin` | Row becomes `missing` / `local-only`; actions refuse. |
| Install target is not a bundle | Refused before pnpm runs, naming the missing `dsh.bundle.patch`. |
| Two actions at once | One in-process queue per bundle; a second request waits. |

## 9. v0 cut — 0.1.0

Ships: one profile, `link:`/`file:` bundles, tracks, check, directions, changelog, compatibility,
`Sync all` and `Update`, track switch, revert, the Updates page, `pam_status`/`pam_update`/`pam_sync`/
`pam_switch`/`pam_revert`, the `pam` CLI, offline tests.

Follows immediately (0.1.x): `pam_install` and the picker, `autoUpdateOnStart`, `pam log`,
`--dry-run` polish.

Not planned: registry bundles, auto-commits, force-push, multi-profile, notifications, diff stat,
dependency installation, tray integration.

Build order, each step green under `npm run check`:

1. Fixture repositories: bare origin, two clones, commits on both sides, one conflict fixture.
2. `lib/git.js` + `lib/version.js`: inspect, counts, both commit lists, changelog.
3. `lib/sync.js`: ff, push, rebase, conflict abort — tested against the fixtures before any UI.
4. `pam status` / `pam sync` — the two-machine loop working from the terminal.
5. Receipts, `pam revert`, state schema.
6. Track switch.
7. Web page, sidebar entry, reload banner.
8. Agent tools.
9. Directory picker and adoption.

## 10. Open questions

- **O1 — does HMR recompose a linked bundle when its directory changes?** The reload banner wording
  depends on it; one throwaway commit answers it.
- **O2 — how does a host plugin learn the profile directory?** If there is no public accessor, state
  moves to `$DSH_HOME/pam/<profile>/`.
- **O3 — conflict UX.** v0 aborts the rebase and hands over commands. Is that enough, or does a
  personal tool want the conflicted files opened in the editor and a "retry when done" button?
- **O4 — `autoUpdateOnStart`.** Off by default; the moment it is on, every start may move three
  checkouts. Probably a per-bundle flag, not a global one.
- **O5 — version bumping.** `pam bump <bundle>` from the changelog would stop the drift note from ever
  appearing. Stretch goal, not v0.

## 11. House conventions

Package `dsh-plugin-pam`, private, MIT when it ships, `engines` floor `dsh ^0.2.1-rc.2`, `node >=22`.
Layout follows the workshop: `index.js`, `lib/`, `client.js`, `client.*.js`, `cordis.patch.yml`,
`test/`, `scripts/check.mjs`, `README.md`. No runtime dependencies beyond `node:*`; every git call is
a `spawn` with an explicit cwd, a timeout and `GIT_TERMINAL_PROMPT=0`. The README's **Limits** section
opens with the two things PAM will not do: commit, and force-push.
