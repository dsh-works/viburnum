# viburnum — a workbench for your own plugins

*A manager that Keeps All Linked Installs Neatly Synced In Two Universes.*

**Status:** design, revision 6, v0 not started
**Date:** 2026-11-06
**Package:** `dsh-plugin-viburnum` · row `viburnum` · panel `viburnum` · binary `vib`
**Repo:** [`dsh-works/viburnum`](https://github.com/dsh-works/viburnum)

> **The name.** viburnum is the shrub that keeps its fruit through the winter: in place, visible,
> current — the same promise this tool makes about a linked checkout. The binary is `vib`; `viburnum`
> ships as the long form, and any personal alias is a shell alias, not a config field.
>
> Revision 4 renamed the project from PAM. Revision 5 gave it a surface — the sidebar row with one status
> dot, and three doors to install. Revision 6 makes it a workbench: a page per plugin, `vib new`, the
> organisation as the catalog, a conflict with three exits, and the bench behind it all (§11).

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

**At its core, viburnum is a sync button for code you wrote.**

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
3. **Safe by construction.** viburnum never commits, never force-pushes, never rebases a published commit
   onto a rewritten base, and aborts a conflicting rebase rather than leaving a half-finished one.
4. **Cheap and legible.** An update is a fetch and a fast-forward; a sync adds a push and, at worst, a
   rebase. Seconds, and every step is a git command he could have typed — which is the point.

This is a wheel. It is being reinvented on purpose, in the one place where the wheel covers his own
three plugins, and where the reinvented one can say "two commits on `dev` are not on `origin/dev`
yet" in a sentence git does not have.

## 3. The model: tracks and directions

Each bundle has a **track**: the branch it follows on this machine. `main` by default, `dev` while
trying something. The track lives in viburnum's state, per machine — not in the repository, not in the
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
| **rebase in progress** | Someone started a rebase. viburnum stops and says so. |

The safety predicate that decides diverged cases: **are the local-ahead commits already published?**
If yes, rebasing them would rewrite shared history and need a force-push — viburnum refuses and says "merge,
or resolve by hand". If no, the rebase is a private rewrite and safe.

## 4. Decisions

| #   | Decision | Consequence |
| --- | --- | --- |
| D1  | **Watch, update, sync, switch, install.** Installing delegates to `plugin_manager.installBundle`; viburnum never runs a package manager. | viburnum stays small and cannot corrupt a profile's dependency graph. |
| D2  | **The track is the unit, per machine.** Bulk helpers move everything to `main` or `dev`. | Different tracks per machine are normal; that is what "trying something on the laptop" looks like. |
| D3  | **Update is fast-forward only.** No rebase, no force, no detached checkout. | Pulling never rewrites anything. |
| D4  | **Sync pushes, reconciles, and pushes again when the rebase moved something.** | The morning button closes the loop in both directions. |
| D5  | **Sync never commits and never force-pushes.** A dirty tree blocks it. | viburnum cannot invent a commit message or overwrite a remote. |
| D6  | **Rebase only when the local commits are unpublished.** Published divergence is refused, with both commit lists shown. | No rewriting history two machines already saw. |
| D7  | **A conflict stops the sync and offers three exits.** Agree (apply a safe suggestion and continue), Guide (reopen the rebase, open the files, retry), Myself (abort and print the commands). Nothing is resolved silently. | The tree never sits mid-rebase unless the user chose Guide, and no conflict resolution is invented. |
| D8  | **Snapshot for update and switch; audit for sync.** Revert restores a pull or a track move, never a pushed rebase. | Undo is honest about which actions are local-only. |
| D9  | **Checks automatic, actions on click — never auto-apply.** There is no `autoUpdateOnStart`: a check may run on start and on an interval, but every move is a click or a command. | Code never changes state while the user is not looking, and there is no config that can make it. |
| D10 | **One core, three faces.** Host service, Web page, tools, CLI binary. | Same calls, different keyboards. |
| D11 | **State with the profile**, `$DSH_HOME/profiles/<name>/.viburnum/`. Never in a bundle repo. | `git status` in any plugin stays clean. |
| D12 | **viburnum updates itself separately.** `Sync all` skips its own row; `Update viburnum` moves the files and says restart. | The tool that must not be stale gets updated honestly. |
| D13 | **Install is adoption, through three doors.** Directory picker, repository URL, or GitHub organisation → validate → `installBundle` → track from the branch it is on. | A new plugin is one choice and lands in the same table. |
| D14 | **Tests are offline.** Fixtures are real repositories: a bare `origin`, two clones, commits on both sides. | Divergence, rebase and conflict are exercised without network. |
| D15 | **`vib` is the command; aliases are the user's.** The package links `vib` and `viburnum` to one entry point; anything else is a shell alias. | The tool answers to its name without owning the keyboard: no alias table to maintain, no runtime string to change. |
| D16 | **One sidebar row, above Plugins.** A `sidebar.panellist` registration ordered before the Plugins row, with the butterfly as its icon. | The tool is one click from anywhere, and it sits with the other panel launchers instead of inventing a second navigation. |
| D17 | **One dot is the whole status language.** Green current, violet pullable, orange uncommitted, red unpushed or diverged, grey unknown; worst state wins across bundles. | A glance answers "is anything wrong" without opening anything. Colour is always paired with words on the page, never the only signal. |
| D18 | **No hover card.** The sidebar owns the row and exposes no hover slot; refresh and detail live on the page, and the row opens it. | The sketch's hover loses; the dot survives. Nothing is built on a seam the harness does not have. |
| D19 | **Three doors to install, one lifecycle.** Directory, repository URL, or GitHub organisation — all end at `pluginManager.installBundle`. | Org browsing is a list you pick from, not a second manager; one code path creates every plugin. |
| D20 | **`vib install .` is the CLI spelling of the directory door.** | The harness's own terminal is the command surface: no in-page bar to build, and the page's buttons are the same verbs without typing. |
| D21 | **`vib new` scaffolds; `init` is not a verb.** It writes a bundle that already satisfies the taxonomy — manifest, patch row, entry, test, README — and leaves git to a flag. | Creating a plugin stops being a memory test, and the organisation door never sees a mis-tagged new repository. |
| D22 | **Hybrid shelf.** New installs clone into a configurable `pluginsDir` (`$DSH_HOME/viburnum/plugins` by default); checkouts the profile already links are watched where they are and never moved. | One lifecycle for what viburnum creates, zero migration for what it inherited. |
| D23 | **"Agree" exists only where a suggestion is safe.** Today that is append-only files where a union merge is correct (a `CHANGELOG.md`) and conflicts whose local side is already contained in the incoming commit; otherwise the button is disabled with the reason. | Auto-resolution is a promise the tool can keep, or it is not offered at all. |
| D24 | **Versions are suggested, never written.** The drift note may add *next would be 0.5.0*, derived from the changelog; `package.json` is never edited by viburnum. | One fewer thing that changes your files, and the nudge still lands. |
| D25 | **The organisation is the catalog.** The list is the union of mounted bundles and installable org repositories, grouped *mounted* and *available*; the available group appears only while the org is reachable, and is cached. | The profile stops being the inventory: what you own lives in the org, what runs lives in the profile, and one page shows both. |
| D26 | **Catalog owners are configured, not hardcoded.** `catalogOwners` defaults to `['dsh-works']`; each entry is an org or a user and is read with the same rules. | A personal account joins the catalog with one config line, and the repository carries no personal handle in its defaults. |

## 5. Surfaces

### 5.0 The sidebar row

A `sidebar.panellist` registration: id `viburnum`, label "viburnum", the butterfly as its icon, and an
`order` that places it above Plugins. The harness renders the icon and passes `{ size, active }`, so the
status dot is drawn *inside our glyph* — no overlay, nothing extra to support in the shell.

The sketch asked for a hover card with a refresh button. That surface does not exist:

| Sketch | Reality |
| :--- | :--- |
| Hover opens a small window | the sidebar owns the row; hover is a background change and a label tooltip |
| Refresh from that window | refresh is a button on the page, plus a background check that runs anyway |
| Status available on hover | the dot is always on the icon |

**The dot.** One dot, aggregated across every watched bundle; the worst state wins:

| State | Colour | Meaning |
| :--- | :--- | :--- |
| current | green | clean, and equal to `origin/<track>` |
| pullable | violet | the remote has commits this machine does not |
| uncommitted | orange | the tree is dirty |
| unpushed / diverged | red | commits here the remote does not have |
| unknown | grey | the check failed, the directory is missing, or there is no `origin` |

Precedence: red > orange > violet > grey > green. Every colour is also spelled out in words on the page:
at nine pixels, orange and red are a guess, and colour alone is not an accessible answer. The dot sits in
the icon's top-right corner over the sidebar background, with a 1 px ring in the icon's ink so it reads on
a light theme.

### 5.1 Web page — "viburnum"

The same panel registration as before, retitled. The page is what the hover was meant to be, one click
later:

```text
viburnum                                    [ Refresh ]  [ Sync all ]  [ Install ▾ ]
2 mounted · 1 available · 1 pullable · checked 2 minutes ago

  ── mounted ────────────────────────────────────────────────────────────────
  Pixel Art      main                     v0.3.0 · 33903c8       ● pullable  ↓12
                 dsh-pixelart-tool · dev +12 (v0.4.0)
  Alerts         feature/subagents-cost…  v0.4.0 · 3c69dc8       ● unpushed  ↑2
                 dsh-plugin-alerts · main +1

  ── available in dsh-works ─────────────────────────────────────────────────
  Pip            dsh-fren                 v1.3.0 · 2 months ago  [ Install ]
```

- **Two groups, one list.** Mounted bundles first; below them the configured owners' `dsh-plugin`
  repositories that are not installed, each with an `Install` button. The second group exists only
  while an owner is reachable (§6.5) and is cached — it is a catalog, not a check.
- **`Refresh` is the hover button.** One fetch pass over every watched bundle, the same code the
  background check runs; the dot updates while the page is open.
- **`Install ▾` opens the three doors**: a directory, a repository URL, or a GitHub organisation.
- **The second line is the directory**, because the package name lies: the profile links
  `dsh-pixelart-tool`, while `dsh-plugin-pixelart` sits beside it on another branch at another
  version. The path is the only honest identifier, so it stays visible.
- **The branch is the version selector**, not a `main`/`dev` toggle. A picker lists local and remote
  branches with `+N` counts against the current head; `main` and `dev` are promoted to chips. Any
  branch is a track, including `feature/subagents-cost-final`.
- **Direction, not status.** `↑2` is a push, `↓3` is a pull, `↑2 ↓3` is a rebase, `✓` is nothing.
  The dot says how bad it is; the arrows say what will happen.
- **Rows expand in place** for the quick actions, and **clicking a bundle's name opens its own page**
  (§5.5) — the workbench, where the loaded version is the question rather than a detail.
- **Both commit lists when diverged**, the changelog for the incoming side, the version drift note, the
  compatibility verdict.
- **Version drift:** `v1.3.0 unchanged across 12 commits`, and where a next version can be derived from
  the changelog, *next would be 0.5.0* — the cheapest reminder for the mismatch that started all this.
  viburnum suggests the number; it never writes it.
- **After an action:** one banner: *pushed 2, pulled 3, rebased 0 · restart `dsh web`* — or *conflict
  in 2 files: `lib/png.js`, `client.panel.js` — rebase aborted*.

### 5.2 Agent tools

| Tool | Arguments | Behavior |
| :--- | :--- | :--- |
| `vib_status` | — | Cached rows and directions. No network, no writes. |
| `vib_update` | `bundle?` | Fast-forward only. Snapshot, gate, receipt. Needs approval: writes outside the workspace. |
| `vib_sync` | `bundle?` | Fetch, push, reconcile, push. Audit entry. Needs approval. |
| `vib_switch` | `bundle`, `track` | Same gate and receipt, different move. Needs approval. |
| `vib_install` | `target` (directory or URL) or `org` | Validate, then `installBundle`. An org target lists repositories first. Needs approval. |
| `vib_revert` | `bundle` | Restores an update or switch receipt. Needs approval. |

A routing sentence in the system prompt so the model proposes `vib_sync` instead of hand-editing a
`link:` path or running `git push` inside a plugin directory.

### 5.3 CLI

`dsh plugin` forwards its arguments to pnpm, so there is no `dsh <tool>` subcommand to hook. v0 ships a
standalone binary instead:

```
vib status [--json]
vib refresh
vib update [<bundle>]
vib sync [<bundle>] [--dry-run]
vib switch <bundle> <track>
vib install <dir|url>
vib install --org <org> [<repo>]
vib new <name> [--git] [--org <org>]
vib revert <bundle>
vib log [--limit 20]
```

`vib install .` needs no special case: the CLI has a working directory, so `.` is already the path it
means. The harness already provides the command surface — a terminal in the sidebar, running a shell in
the workspace — so there is no in-page bar to build. Type the verb there, or press the button on the page.

For that to work, `vib` has to be on `PATH`: `npm link` from the package directory, or a global install.
The page's buttons never need it.

The package links both `vib` and `viburnum` to the same entry point. A personal alias — a line in a shell
profile, or a symlink in a bin directory — works without the plugin knowing anything about it: the name
you type belongs to the shell.

Exit codes: `0` success, `1` failure, `3` something is pending (updates or unpushed commits).
`--dry-run` prints the reconciliation plan and touches nothing.

### 5.4 Three journeys

**A glance.** The dot is blue: something can be pulled. Click it and the page opens with *Alerts is 3
commits behind `origin/main`; Pixel Art has 2 commits that are not on `origin/main`.* `Refresh`
re-checks while the page is open, `Sync all` runs, and the dot turns green before the banner finishes.

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
| conflict | *! 2 files conflict: `lib/png.js`, `client.panel.js`* — with **Agree** (when a safe suggestion exists), **Guide**, **Myself** |
| auth | git's own sentence, quoted once, no retry loop |

### 5.5 The plugin page — the workbench

The list is triage; this page is for working on one plugin. Clicking its name opens it.

```text
← viburnum        Pixel Art                        dsh-plugin-pixelart · v0.3.0

  loaded from   dsh-pixelart-tool                  ● current
  branch        dev ▾                              main · dev +12 (v0.4.0) · feature/…
  direction     ↓12                                pull 12 commits from origin/dev
  changelog     0.3.0 → 0.4.0 …                    [ Update ]  [ Revert ]
  opens         folder · README · CHANGELOG · terminal
```

- **The branch is the hero control.** Local and remote branches, each with `+N` against the current
  head; switching is one click and reversible, and the page names what will change (browser half, host
  half, dependencies) before you do it.
- **Branches only.** Tags and commits stay in the terminal: a detached HEAD is a state this tool refuses
  to enter by accident, and Revert already covers "put it back".
- **Status, direction, the incoming changelog and the last receipt** live here. The list keeps the dot
  and the quick sync; this page is where a version is chosen.
- **Opens** is the workbench half: the folder, the README, the CHANGELOG, and a terminal already in
  that directory (0.1.x).

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
                     git rebase --abort          (before anything is reported)
                     return the files; the page offers Agree / Guide / Myself
                     Guide re-runs the rebase and opens the files
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

### 6.5 Install — three doors

```text
1  directory   ctx.directoryPicker (native.pick() or the browse flow)
2  repository  git clone <url> <shelf>/<name>
3  org         list the org's repositories, keep the ones whose package.json declares
               dsh.bundle.patch, then door 2 for the pick
→  validate, pluginManager.installBundle(absoluteDir), track = the checkout's current branch
```

Door 1 needs no network. Door 3 needs the GitHub API: a public organisation answers without a
credential, a private one resolves a configured *reference* through `ctx.credentials` — a `GITHUB_TOKEN`
environment variable, never a token in the plugin's config. Listing is a read; nothing is cloned until a
repository is picked. With no token configured the door is shown disabled, with one line naming
`GITHUB_TOKEN`, rather than hidden.

The catalog is cached and refreshed by `Refresh`, not re-read on every background check: a page that
cannot reach the org simply shows the mounted group and the disabled door.

The manager owns pnpm, bundle selection, and compatibility; viburnum reports its answer verbatim.

**The shelf (D22).** viburnum clones only what it installs itself. Doors 2 and 3 target `pluginsDir` —
`$DSH_HOME/viburnum/plugins/<repo>` by default, configurable at any time. Everything the profile already
links stays where it is: a checkout under `Documents/…` is watched in place and never moved. Each bundle
records whether it came from the shelf or was linked externally, so *Remove* only ever deletes a
directory viburnum created.

**The catalog, given the taxonomy.** Owners are configured — `catalogOwners`, default `['dsh-works']` —
and each entry is an org or a user, read with the same rules. `dsh-works` tags every repository with at
most one kind topic (`dsh-plugin`, `dsh-skill`, `dsh-process`, `dsh-org`), but a topic is a grouping hint,
not proof. The door lists each owner's repositories, skips archived ones, and reads `package.json` at the
default branch: `dsh.bundle.patch` is the only thing that makes a repository installable. A repository
tagged `dsh-plugin` without that manifest is an error row; a bundle without a kind topic is importable
and labelled *untagged*. The plugin repositories are private by default — `viburnum` itself is
public — so the door is token-first.

Configuration so far: `catalogOwners`, `pluginsDir`, `checkIntervalMinutes`, `fetchTimeoutMs`.

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
| Install | `git clone` for doors 2–3, then `pluginManager.installBundle(<dir>)` (pnpm runs inside the manager) |

### 6.8 New bundle

```text
vib new <name> [--git] [--org <org>]

<name>/                         package  dsh-plugin-<name>
  package.json      0.0.0, private, type module, engines, dsh.bundle.patch → ./cordis.patch.yml
  cordis.patch.yml  one insert row: id <name>, name dsh-plugin-<name>
  index.js          name, inject, apply — a shell that does nothing yet
  lib/              one placeholder module, so the first import has a home
  test/             one smoke test: the shell exports what the patch row expects
  README.md         what it does, how it is installed, what it cannot do
  .gitignore, .editorconfig
```

- Refuses a directory that exists and is not empty. No `--force`.
- `--git` initialises `main` and makes the first commit; without it, files only.
- `--org` creates the repository and applies the `dsh-plugin` topic (0.2; 0.1 prints the command instead).
- The template is a directory inside the package with three substitutions — `<name>`, `<package>`,
  `<description>`. No wizard, no prompts, and no network without `--org`.

## 7. State

`$DSH_HOME/profiles/<name>/.viburnum/state.json`:

```jsonc
{
  "version": 2,
  "bundles": {
    "dsh-plugin-pixelart": {
      "track": "dev",
      "lastCheck": "2026-11-03T08:40:00Z",
      "dir": "C:/Users/…/dsh-pixelart-tool",
      "origin": "linked",
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
and the tools may touch it at once. `origin` is `shelf` for a directory viburnum cloned and `linked` for
one it found — the only thing that decides whether *Remove* may delete files.

## 8. Failure modes

| Failure | What viburnum does |
| :--- | :--- |
| Offline / fetch times out | Keeps the previous row, marks it stale, no dialog. |
| Push rejected (non-fast-forward) | Reports it, shows both lists, never retries with force. |
| Auth required | Fails with git's message and a timeout; credentials stay git's business. |
| Dirty tree | Blocks update, sync and switch; prints the `git stash` and diff stat. |
| Diverged, local commits published | Refuses; suggests a merge; lists the commits. |
| Diverged, local commits private | Rebases, then pushes. |
| Rebase conflict | Aborts before reporting, lists the files, offers Agree / Guide / Myself; never resolves silently. |
| Rebase already in progress | Stops; names the directory and the command to finish or abort it. |
| Detached head | Blocks sync; lists the branches it can switch to. |
| `engines.dsh` unmet | Blocks before the move, names both versions; `--force` for the deliberate case. |
| Directory missing / no `origin` | Row becomes `missing` / `local-only`; actions refuse. |
| Install target is not a bundle | Refused before pnpm runs, naming the missing `dsh.bundle.patch`. |
| Two actions at once | One in-process queue per bundle; a second request waits. |

## 9. v0 cut — 0.1.0

Ships: one profile, `link:`/`file:` bundles, the sidebar row and its dot, the viburnum page with
`Refresh`, tracks, check, directions, changelog, compatibility, `Sync all` and `Update`, track switch,
revert, `vib_status`/`vib_update`/`vib_sync`/`vib_switch`/`vib_revert`, `vib status|refresh|sync`,
offline tests.

Follows immediately (0.1.x): the plugin page (workbench), install (directory, then repository URL),
`vib new`, the GitHub organisation door and its shelf, the timeline, `vib log`, `--dry-run` polish.

Not planned: registry bundles, auto-commits, force-push, multi-profile, notifications, diff stat,
dependency installation, tray integration.

Build order, each step green under `npm run check`:

1. Fixture repositories: bare origin, two clones, commits on both sides, one conflict fixture.
2. `lib/git.js` + `lib/version.js`: inspect, counts, both commit lists, changelog.
3. `lib/sync.js`: ff, push, rebase, conflict abort — tested against the fixtures before any UI.
4. `vib status` / `vib sync` — the two-machine loop working from the terminal.
5. Receipts, `vib revert`, state schema.
6. Track switch.
7. Web page, sidebar row and dot, reload banner.
8. Agent tools.
9. Install: directory picker, then repository URL, then the organisation door and its shelf.

## 10. Open questions

- **O1 — does HMR recompose a linked bundle when its directory changes?** The reload banner wording
  depends on it; one throwaway commit answers it.
- **O2 — how does a host plugin learn the profile directory?** If there is no public accessor, state
  moves to `$DSH_HOME/viburnum/<profile>/`.
- **O3 — conflict UX: resolved (D7, D23).** Abort first, then Agree / Guide / Myself; Guide is the only
  path that leaves a rebase open.
- **O4 — auto-apply: resolved (D9).** None, ever. The check may run on start and on an interval; every
  move is a click or a command.
- **O5 — version bumping: resolved (D24).** Suggested in the drift note, never written; there is no
  `vib bump`.
- **O6 — shelf or viewer: resolved.** Hybrid (D22): a shelf for what viburnum clones, nothing moved for
  what it inherited.
- **O7 — the catalog's leftovers.** Shown disabled without a token, and cached between refreshes. Still
  open: the token's minimum scope.
- **O8 — command bar: resolved (D20).** None. The harness's terminal is the command surface; the page
  keeps buttons.
- **O9 — colour language: resolved (D17).** Violet for pullable; precedence red > orange > violet > grey >
  green.

## 11. On the bench

Agreed in shape, not yet scoped into a version.

**The timeline.** What the dot cannot say: *what changed*. Derived from a fetch with one extra field —
a `lastSeen` timestamp per bundle: commits that arrived on `origin/<track>` since the page was last
opened, plus the actions already in the history (switch, sync, install). Shown at the top of the page as
a short feed — `23:41 · alerts · +3 from the other machine · "fix subagent cost"` — and cleared by
looking at it.

**Hygiene.** A scan of the workspace and the shelf, a couple of levels deep, for what the profile cannot
see: two checkouts of the same package (today: `dsh-pixelart-tool` at 0.3.0 and linked, next to
`dsh-plugin-pixelart` on `feature/standards-audit` at 0.4.0), branches never merged into `main`, trees
dirty for days, versions that never move. It reports and suggests; it never deletes, and it never leaves
those two roots.

**The agent brief.** The timeline is also the answer to "why does the panel look different?" — a
`vib_brief` tool returning status plus what changed since the last brief, so a session starts informed.
Cheap once the timeline exists; not worth building before it.

## 12. House conventions

Package `dsh-plugin-viburnum` (private on npm), MIT licence, `engines` floor `dsh ^0.2.1-rc.2`, `node >=22`.
Layout follows the workshop: `index.js`, `lib/`, `client.js`, `client.*.js`, `cordis.patch.yml`,
`test/`, `scripts/check.mjs`, `README.md`. No runtime dependencies beyond `node:*`; every git call is
a `spawn` with an explicit cwd, a timeout and `GIT_TERMINAL_PROMPT=0`. The README's **Limits** section
opens with the two things viburnum will not do: commit, and force-push.
