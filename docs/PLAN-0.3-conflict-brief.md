# conflict exits and the brief — plan delta

- **Tier:** feature on a released plugin (viburnum 0.2.2), planned for **0.3.0**
- **Revision:** 1
- **Branch:** `feature/conflict-exits-brief`, cut from `dev`
- **Parent plan:** [`PLAN.md`](PLAN.md), decisions D7 / D23 in [`DESIGN.md`](../DESIGN.md)
- **Approved by:** the repository owner on 2026-11-09 (chose all four recommended options in the
  clarification round)

## Decisions taken

| Question | Decision |
|---|---|
| Default on conflict | **Leave the rebase stopped** and show Agree / Guide / Myself; nothing auto-aborts. |
| Agree scope | **Only append-only allowlist files** (`CHANGELOG.md` and `docs/CHANGELOG.md` style); any other conflict disables the button with the file named. |
| Guide | **Open the conflicted files in the desktop editor**, then a Retry button continues the rebase and pushes. Add/add conflicts (no common base) are refused by Agree with a reason. |
| Surface | **Page + CLI**; `vib_sync` only reports the conflict and its exits (no tool-driven exit). |

## Outcome

- A conflict is no longer a dead end that silently disappears: the page shows the bundle, the files,
  the three exits, and per-file **Open** buttons; Agree is enabled only when every file is
  append-only; Retry continues after the user stages a resolution; Myself aborts.
- `vib sync --agree|--continue|--abort <bundle>` gives the same three exits in the terminal.
- `vib_brief` is a new read-only model tool (and `vib brief` CLI command): the aggregate dot, every
  bundle's state, harness warnings, and what changed since the previous brief (the timeline, marked
  read). A session can start informed without calling `vib_status` plus reading history.

## Surface

- **Host:** `lib/git.js` gains conflict-file listing, `rebase --continue` (no-op editor), stage reads,
  path staging and a `merge-file --union` helper. `lib/sync.js` gains `agreeConflict`,
  `continueConflict`, `abortConflict` and returns a conflict receipt with `files` and `exits` instead
  of aborting. `lib/core.js` adds `conflictExit`, `conflictPath` and `brief`; the guarded action pair
  gains `conflict` and `open-conflict`; tools gain `vib_brief`.
- **Browser:** conflict panel with Agree (disabled with reason when unsafe), Retry, Myself and Open
  buttons; success/refusal flows through the existing receipt banner.
- **CLI:** the three sync flags and `vib brief [--json]`.
- Rejected: a tool-driven exit (the model can report, the human chooses), auto-resolving
  non-append-only files, and auto-abort (it hides the conflict).

## Non-goals

- `Agree` beyond append-only files; add/add changelog conflicts; resolving binary conflicts.
- Auto-staging the user's manual edits (Retry expects the resolution to be staged).
- A page timeline for `vib_brief` beyond the existing page feed.

## Acceptance checks

| # | Trigger | Expected result | Observed by | Result |
|---|---|---|---|---|
| 1 | Sync hits a README conflict | rebase stops; result carries files + exits; Agree disabled with the file named | fixture test | **pass** — `sync leaves a conflicting rebase stopped with three exits` |
| 2 | Sync hits a CHANGELOG conflict, Agree | union-merge keeps both additions, rebase continues, push succeeds | fixture test | **pass** — both additions present, remote matches local, counts 0/0 |
| 3 | Resolve by hand, stage, Retry | rebase continues and pushes | fixture test | **pass** — `Retry continues a rebase after a manual resolution` |
| 4 | Myself | rebase aborts and the tree returns to the pre-rebase state | fixture test | **pass** — abort returns ahead 1/behind 1 and no rebase in progress |
| 5 | `vib_brief` / `vib brief` | status + warnings + changed-since feed; a second brief has no events | tool + CLI tests | **pass** — tool render test and CLI `brief` test; core test proves the feed clears |
| 6 | `npm run check` | all suites green | command transcript | **pass** — 132 tests, 0 failures at this revision (the suite is 150 after the terminal-setting and cross-platform work) |
