# PAM — plugin auto manager

**Status:** design, v0 not started
**Date:** 2026-11-02
**Package:** `dsh-plugin-pam` · row `pam` · panel `pam`
**Repo:** [`dsh-works/pam`](https://github.com/dsh-works/pam)

---

## 1. The problem

A bundle in this workshop is a directory: cloned once, linked into the profile with `link:`, then
forgotten. Two facts make that forgetfulness expensive.

**The profile records a path, not a version.** The web profile currently declares:

```json
"dsh-plugin-pixelart": "link:C:/Users/…/dsh-pixelart-tool",
"dsh-plugin-alerts":   "link:C:/Users/…/default-workspace/dsh-plugin-alerts"
```

pnpm records the link. Nothing in the profile says which commit is running. `plugin_manager` can
install, remove, enable and inspect compatibility, and `plugin_market` can list what a registry
offers — but neither watches code that is already on disk.

**None of the three bundles has a single git tag** (checked 2026-11-02 in `dsh-pixelart-tool`,
`dsh-plugin-alerts`, `dsh-fren`). So even a tag-watcher would have nothing to watch. The product has
to be useful in a world of untagged commits, and it should make tagging feel worth doing rather than
require it.

Today "is there a newer Pixel Art?" is answered by remembering to `git fetch` in four directories,
reading a CHANGELOG by hand, checking out by hand, and restarting by hand. That is the loop PAM
exists to remove.

## 2. Thesis

**PAM is a watcher and a handle, not an installer.**

```
list the links → fetch each clone → compare HEAD with its own remote
             → read what changed → check out the new tag → leave a receipt
```

Four constraints follow from how these bundles are actually installed:

1. **Git is the source of truth.** The profile says "this directory"; the directory says which commit.
   PAM reads git, not a manifest, and invents no version registry of its own.
2. **Apply is a checkout, not an install.** The profile's dependency does not change, so there is no
   pnpm run, no lockfile write, no `package.json` edit. PAM moves one working tree to one commit and
   lets DSH recompose (or tells you to restart). This is why PAM is a small plugin and not a fork of
   `plugin_manager`.
3. **Uncommitted work is sacred.** PAM never checks out over a dirty tree, never stashes silently,
   never force-switches a branch it did not leave.
4. **Every apply leaves a revert.** A receipt with the previous commit, the branch, and a copy of the
   profile files. One click puts all of it back.

## 3. What "current" means

| Thing          | Definition                                                                                                 |
| :------------- | :--------------------------------------------------------------------------------------------------------- |
| **installed**  | `HEAD` of the linked directory, plus the nearest tag behind it (`git describe --tags --abbrev=0`) and the commit count since. |
| **available**  | After `git fetch`: the newest semver tag on the remote if any; otherwise the remote default branch head.    |
| **up to date** | remote target commit === `HEAD`, and the tree is clean.                                                     |
| **update**     | remote target is a descendant of `HEAD` (fast-forwardable) and not equal to it.                             |
| **ahead**      | `HEAD` has commits the remote target does not — a local branch, not an update. Shown, never "fixed".        |
| **blocked**    | dirty tree, detached head with no receipt, missing directory, not a git checkout, incompatible `engines.dsh`. |

Display is honest about the untagged case:

```
Pixel Art   HEAD 4f2a91c · no tags · 12 commits on origin/main   →   origin/main 8c1de02
Alerts      v0.4.0 +3 commits                                    →   v0.5.0   (2026-10-28)
Pip         v1.3.0                                               →   up to date
```

Two version orderings: semver when both sides parse (`v` prefix optional), otherwise commit date and
count. Mixed tags and branches are ordered by semver first, then by commit date.

## 4. Decisions

| #   | Decision | Consequence |
| --- | --- | --- |
| D1  | **Watch and apply only.** Install, remove, enable/disable and exemptions stay in `plugin_manager` and the Plugins page. | PAM can be installed and removed without ever being the reason a profile is broken. No overlap in authority. |
| D2  | **Local git is the only source in v0.** Tags first, branch head second. Registry and git-spec bundles are listed as "not watched". | The common case works on day one. A source interface keeps a registry adapter cheap later. |
| D3  | **Apply is `git switch --detach <target>` in the linked directory.** No profile write, no pnpm, no lockfile. | Fast and reversible. The clone ends at the release commit, not on a moving branch. |
| D4  | **A dirty tree blocks apply.** No automatic stash. | The user's work is never moved without them. The UI offers the exact `git stash` command to run themselves. |
| D5  | **Snapshot before apply; Revert restores it.** Receipt holds previous commit, branch, and copies of the profile files. | Undo is one click, and survives an apply that seemed fine until the next restart. |
| D6  | **Compatibility is checked before switching.** `engines.dsh` and DSH peers of the target commit against the running harness. | A bad tag is refused before the tree moves, with the same vocabulary `plugin_manager` uses for installs. |
| D7  | **Checks run on their own; applies never do.** On start after a delay, then every `checkIntervalMinutes`. | The page is already right when you open it. Nothing installs while you are not looking. |
| D8  | **One core, three faces.** Host service, Web page, two tools, one CLI binary. | The page is the default face; the tools and CLI are the same calls with a different keyboard. |
| D9  | **State lives with the profile**, in `$DSH_HOME/profiles/<name>/.pam/`. Never in a bundle repo. | One profile's history cannot leak into another checkout, and `git status` in a bundle stays clean. |
| D10 | **v0 does not manage itself.** PAM's row is excluded from its own lists. | Self-update while running is a restart problem, not a feature; defer it. |
| D11 | **Tests are offline.** Fixtures are real git repositories: a bare origin in a temp dir, cloned, committed, tagged. | The fetch path is exercised without network, and CI does not depend on GitHub being up. |

## 5. Surfaces

### 5.1 Web page — "Updates"

Registered exactly like the Plugins page: a keyed `main` panel with id `pam` plus a `sidebar.panellist`
entry, selected through `ctx.layout.selectPanel('pam')`. No new layout primitive.

- **Table:** bundle, current, available, when, action. One row per watched bundle; unwatched bundles
  are absent rather than greyed out.
- **Detail:** the changelog between the two commits, the version jump and tag date, the compatibility
  verdict, and the two buttons that matter: `Update` and `Revert`. Revert appears only when a receipt
  exists, and says what it returns to.
- **Blocked rows** say why in one sentence and quote the command that unblocks them.
- **After apply:** a banner naming what changed — *browser half, refresh the page* or *host half,
  restart `dsh web`* — rather than a generic "done".
- **Empty state:** "Every watched bundle is at its remote. Last checked 12:41." A page that is calm
  when there is nothing to do.

### 5.2 Agent tools

| Tool | Arguments | Behavior |
| :--- | :--- | :--- |
| `pam_check` | `fetch?: boolean` | Returns the same rows the page shows, capped at 1 KB of changelog each. Read-only against the profile. |
| `pam_apply` | `bundle`, `to?` | Snapshot, gate, checkout, receipt. Requires approval: it writes outside the workspace. |
| `pam_revert` | `bundle` | Restores a receipt. Requires approval. |

Same shape as the house tools: `buildTools()` in `lib/tools.js`, a routing sentence in the system
prompt so the model proposes an update instead of editing `link:` paths by hand.

### 5.3 CLI

`dsh plugin` forwards its arguments to pnpm, so there is no supported `dsh pam` subcommand to hook.
v0 ships a `pam` binary in the package:

```
pam status [--json]          every watched bundle, cached
pam check [--fetch]          refresh, then print
pam update <bundle> [--to <tag>]
pam revert <bundle>
pam log [--limit 20]
```

Exit codes: `0` success, `1` failure, `3` updates available (for `check`, so a script can branch).
If DSH grows a command-extension point, the binary becomes a thin wrapper around the same service.

## 6. How it works

### 6.1 Check

```text
bundles = pluginManager.listBundles()
for each bundle with source =~ /^(link|file):/
  dir = absolute path from source
  skip if missing, or if dir/.git is absent          → "not watched"
  head    = git rev-parse HEAD
  branch  = git rev-parse --abbrev-ref HEAD
  tag     = git describe --tags --abbrev=0
  dirty   = git status --porcelain is non-empty
  fetch   = git fetch --tags --prune origin          (timeout, prompts disabled)
  target  = newest semver tag, else origin/HEAD
  status  = dirty | ahead | update | current | blocked
  changelog = see 6.4
```

One `git` child process per call, never a shell: `spawn('git', args)` with an explicit cwd, a timeout,
`GIT_TERMINAL_PROMPT=0`, and no user input on stdin. A bundle whose fetch fails keeps its previous row
with a stale timestamp instead of disappearing.

### 6.2 Apply

1. Re-read the bundle: it must still be clean and at the commit the user saw.
2. Resolve target to a commit; refuse a target that is not a descendant.
3. Gate on `engines.dsh` and DSH peers read from the target's `package.json`.
4. Write the receipt and the profile-file copies.
5. `git switch --detach <commit>`.
6. Verify: `HEAD` is the target, `package.json` parses, the declared version matches the tag.
7. Report the reload class (6.5). Steps 5–6 are transactional: a failure at 6 switches back before
   returning the error, and no receipt is kept.

A load failure that only shows up at the *next* start is not covered in v0; D5's Revert is the answer,
and a `pam doctor` check at startup is on the bench, not in scope.

### 6.3 Revert

Only from a receipt. Refuses when `HEAD` is no longer the applied commit ("the clone moved since this
update") unless forced. Restores the branch from the receipt, then the profile files. Reverting a
revert is just applying the old tag again.

### 6.4 Changelog extraction

In order of preference, stopping at the first hit:

1. `git show <target>:CHANGELOG.md`, split on `^## `, pick the section whose heading contains the
   target version.
2. The whole of that file up to the first second-level heading.
3. `git log --no-merges --format='%h %s' <from>..<to>`.
4. `git log -1 --format='%h %s' <target>`.

Capped at `changelogBytes` (16 KB default), rendered as plain text, no HTML. Missing changelog is not
an error — it is a row that says "no changelog; 7 commits".

### 6.5 Reload class

`git diff --name-only <from>..<to>` decides the message:

| Changed paths | Message |
| :--- | :--- |
| `client*.js`, `lib/client*`, `locale/**` | Browser half — refresh the page. |
| `index.js`, `lib/**` | Host half — restart `dsh web`. |
| `package.json` dependencies | Also: dependencies changed; run the install yourself. |
| anything else | No reload needed. |

With HMR on, DSH may recompose by itself; the banner stays, because "probably live" is not a promise
this plugin should make. **Open question O1** verifies the real behavior before the wording is frozen.

## 7. State

`$DSH_HOME/profiles/<name>/.pam/state.json`:

```jsonc
{
  "version": 1,
  "checks": {
    "dsh-plugin-pixelart": {
      "at": "2026-11-02T16:40:00Z",
      "dir": "C:/Users/…/dsh-pixelart-tool",
      "head": "4f2a91c",
      "branch": "main",
      "tag": null,
      "target": { "kind": "branch", "ref": "origin/main", "sha": "8c1de02" },
      "status": "update",
      "changelog": "…",
      "error": null
    }
  },
  "history": [
    {
      "bundle": "dsh-plugin-alerts",
      "at": "2026-11-01T09:12:00Z",
      "from": { "sha": "a1b2c3d", "branch": "main" },
      "to": { "sha": "e4f5a6b", "tag": "v0.5.0" },
      "result": "applied",
      "snapshot": "2026-11-01T09-12-00-dsh-plugin-alerts.json"
    }
  ]
}
```

Snapshots live beside it in `.pam/snapshots/` and carry copies of `package.json`,
`cordis.patch.yml` and `compatibility.json`. Retention: 50 history entries, 20 snapshots, 30 days.
The file is written atomically (temp + rename), because two faces may touch it at once.

## 8. Failure modes

| Failure | What PAM does |
| :--- | :--- |
| Offline / fetch times out | Keeps the previous row, marks it stale, no error dialog. |
| Remote requires auth | Same as offline, with the git error quoted once. PAM never handles credentials; it inherits git's. |
| Dirty tree | Blocks apply, shows `git stash` and `git diff --stat`. |
| Untagged repo | Shows commit ids and counts; "no tags" is a state, not an error. |
| Detached head, no receipt | Blocks apply; offers the branch names it can switch to. |
| `engines.dsh` unmet | Blocks before the switch, names both versions, links the harness upgrade path. |
| Directory moved or deleted | Row becomes "missing"; apply and revert refuse. |
| Bundle not a git checkout | Not watched, with the reason. |
| Apply fails after the switch | Switches back, returns the error, keeps no receipt. |
| Profile directory not writable | The check still runs in memory; apply refuses with the path. |
| Two applies at once | A single in-process queue per bundle; a second request waits or is refused. |

## 9. v0 cut — 0.1.0

Ships: one profile, `link:`/`file:` bundles, check (start + interval + manual), changelog, compatibility
gate, apply, revert, the Updates page, `pam_check`/`pam_apply`/`pam_revert`, the `pam` CLI, offline tests.

Not in v0: registry bundles, auto-apply of any kind, self-update, multi-profile, notifications, diff
stat, dependency installation, rollback of anything but the checkout and the profile files, Windows
service/tray integration.

Build order, each step ending at a green `npm run check`:

1. Fixture repos + `lib/git.js` + `lib/version.js` — resolve, describe, compare, changelog.
2. `lib/check.js` against a stubbed `pluginManager`; state read/write.
3. `pam status` / `pam check` — first visible result, no UI.
4. `lib/apply.js`, `lib/revert.js`, receipts, transactional switch-back.
5. Agent tools.
6. Web page and sidebar entry.
7. Background check on start and interval.

## 10. Open questions

- **O1 — does HMR recompose a linked bundle when its directory changes?** The banner wording depends on
  it. Verify with a one-line commit in a linked clone before writing "probably live" anywhere.
- **O2 — how does a host plugin learn the profile directory?** `plugin_manager` reads launcher facts.
  If there is no public accessor, state goes to `$DSH_HOME/pam/<profile>/` with the profile name from
  config, and the location is documented.
- **O3 — dependency changes.** If the target's `package.json` changes dependencies, v0 warns and stops.
  Is a profile `install` behind an approval worth adding in 0.2, or is that `plugin_manager`'s job?
- **O4 — tag convention.** Accept `v0.5.0` and `0.5.0`, warn on anything else, and make `pam tag` a
  stretch goal that proposes the next tag from the changelog.

## 11. House conventions

Package `dsh-plugin-pam`, private, MIT when it ships, `engines` floor `dsh ^0.2.1-rc.2`, `node >=22`.
Files follow the workshop layout: `index.js`, `lib/`, `client.js`, `client.*.js`, `cordis.patch.yml`,
`test/`, `scripts/check.mjs`, `README.md`. No runtime dependencies beyond `node:*`; every git call is
a `spawn`. The README gets a **Limits** section that opens with the registry gap.
