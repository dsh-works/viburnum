# workbench page — timeline and hygiene delta

- **Tier:** feature on a released plugin (viburnum 0.1.0), seventh delta of 0.2
- **Revision:** 1
- **Parent plan:** [`PLAN-0.2.md`](PLAN-0.2.md)
- **Approved by:** the repository owner on 2026-11-09 ("lessgo")

## Outcome

Two views the dot cannot give:

- **Timeline:** a short feed of what changed — incoming commits that arrived on a bundle's track
  since the last look, plus the moves viburnum itself made (sync, update, switch, revert, install).
  Reading the feed clears it (`vib log`, or the page on load and after each action).
- **Hygiene:** a read-only scan of the workspace and the shelf for what the profile cannot see:
  duplicate checkouts of the same package, local branches never merged into `main`, and trees dirty
  since their last commit. It reports and suggests; it never deletes, moves or checks anything out.

## Surface

- **Host:** state schema 3 adds `timeline` and `seen`; `core.timeline()` returns unread events and
  marks them read; `core.hygiene()` delegates to the injected `hygieneScanner`
  (`lib/hygiene.js`, depth 3, at most 40 checkouts, skips `node_modules`/`dist`/`profiles`/…). Route
  actions `timeline` and `hygiene`.
- **Incoming detection:** each refresh compares the bundle's `head`/`behind` against the last seen
  values stored in `state.seen`; a new behind count or upstream head appends an `incoming` event with
  up to three commit subjects.
- **Browser:** a `Hygiene` button opens the findings panel (scan, suggestion per finding); the
  timeline feed renders above the rows (`hh:mm · bundle · kind: text`).
- **CLI:** `vib log` (marks read), `vib hygiene` (exit 3 when findings exist), both with `--json`.
- Rejected: a database or daemon; the feed is the existing state file, and the scan is one bounded walk.

## Non-goals for this delta

- `vib_brief` (a tool-level brief — the design says it is cheap once the timeline exists, later).
- Auto-fixing hygiene findings; leaving the workspace/shelf roots; git history archaeology beyond
  "not merged into main".
- Push notifications.

## Acceptance checks

| # | Trigger | Expected result | Observed by | Result |
|---|---|---|---|---|
| 1 | A move (sync/update/switch) then `vib log` | the receipt appears once, the next `vib log` says nothing new | command transcript | not run |
| 2 | The page loads after an incoming commit | the feed shows `incoming` with the first subject; reloading the page after reading shows no repeat | live page | not run |
| 3 | `vib hygiene` over a workspace with a duplicate, an unmerged branch and a dirty tree | all three findings with suggestions, exit 3 | command transcript | not run |
| 4 | Hygiene over a clean workspace | no findings, nothing deleted | fixture test | not run |
| 5 | `npm run check` | state migration, timeline clearing, hygiene scan and CLI tests pass | command transcript | **pending** |
