# sync visibility — plan delta

- **Tier:** feature on a released plugin (viburnum 0.3.0), planned for **0.4.0**
- **Revision:** 1
- **Branch:** `feature/sync-visibility`, cut from `dev`
- **Parent plan:** [`PLAN.md`](PLAN.md); decisions D2, D5, D9, D12, D17 in
  [`DESIGN.md`](../DESIGN.md); §5 (the page), §6.1 (the check)
- **Approved by:** the repository owner on 2026-11-18 (approved the plan delta before source changes)

## Why

An incident on the live profile (2026-11-18) produced this report from `Sync all`:

```text
refused: not-on-track · refused: dirty · pushed 0 · pulled 0 · rebased 0
```

The checks were right; the reporting contradicted them.

- `dsh-plugin-alerts` was checked out on `dev` while its track was `main` — a back-merge of `main`
  into `dev` done outside viburnum. The check classified the row `remote-ahead`, the page counted it
  in *1 pullable* and the dot said violet, yet the move gate could only refuse it with
  `not-on-track`. The row displayed the *track* and never the checked-out branch, so the mismatch
  was invisible until the click.
- Only the aggregate refusal **code** reached the banner. `lib/sync.js` already composes the
  actionable message (*the checkout is on "dev", not on its track "main" — switch to the track
  first*), the CLI and the model-facing tools print it, but `client.js` drops it.
- The same for the second row: `refused: dirty` without the count or the "commit or stash" hint.
- `Sync all` deliberately omits viburnum's own row (D12) and says nothing about the omission, so the
  report looked complete while covering two of three rows.

D17 promises the dot answers "is anything wrong" and the design promises words next to colour; both
were wrong at the one moment that mattered. The fix is to make the check track-aware and make the
result surface say what happened and how to unblock it.

## Decisions taken

| Question | Decision |
|---|---|
| Is off-track an error or a status? | **A status.** `off-track` joins the check vocabulary: dot **orange** (warn), words *off track*. The move refusal (`not-on-track`) is unchanged. |
| Precedence against dirty | **dirty wins.** It mirrors the move gate order (dirty, then off-track), so the row reports the first blocker the user will meet. |
| Direction counts | **Unchanged.** `↑`/`↓` still count against `origin/<track>`; the row gains the checked-out branch when it differs. |
| Where the branch shows | Overview row (`main (on dev)`), workbench subtitle, and the `vib status` / `vib_status` / `vib brief` lines. |
| Refusal copy | Every refusal banner line becomes `<bundle>: refused: <code> — <message>`, using the `message` the action already returns. |
| `Sync all` completeness | The batch carries `skipped: [<own package>]`; page, CLI and tools print *not synced: dsh-plugin-viburnum — it updates itself (D12)*. |
| Hygiene | A new `off-track` finding with the suggestion to switch to the track (or re-track the current branch); the scanner takes an optional track map supplied by the core. |
| Remedy | **No auto-remediation.** No automatic `git switch`, no auto-stash, no blocking dialog (D9, D5). The page's existing track control is the remedy. |

## Surface

- **Host**
  - `lib/status.js` — `STATUS.offTrack`; `classify` gains `track` and `branch`; `DOT[off-track] =
    orange`; `checkBundle` passes both through. A bundle with no track keeps today's behaviour (the
    current branch is the track, so it can never be off-track).
  - `lib/core.js` — the sync-all batch gains `skipped` (the own row); the hygiene call passes the
    watched tracks to the scanner.
  - `lib/hygiene.js` — optional `tracks` map (resolved dir → track) and the `off-track` finding for a
    checkout whose branch differs from its track.
  - `lib/tools.js` — status/brief lines show the branch hint; a refusal line keeps the bundle name
    (`<bundle>: refused: <code> — <message>`); a sync-all result lists the skipped own row.
- **Browser** (`client.js`) — `'status.off-track': 'off track'`; the track cell adds `(on <branch>)`
  when the checkout is off its track; the workbench subtitle adds the branch; `describeResult`
  appends the refusal message and the bundle name; a sync-all banner notes the skipped own row.
- **CLI** (`bin/vib.js`) — status rows show the branch hint; a sync-all print lists the skipped row.
- **Docs** — `DESIGN.md` §5 dot table (orange meaning widened to "needs a local action"), §6.1
  status list, D17 wording, and a new **D27** recording off-track as a status; `README.md` status
  and after-action wording; `CHANGELOG.md` gains the 0.4.0 section at release.
- Rejected: a preflight that blocks `Sync all` behind a dialog; a new dot colour (orange already means
  "needs a local action"); changing the move policy, the refusal codes or the track model.

## Non-goals

- Auto-switching a checkout onto its track, auto-stashing, or auto-committing a dirty tree.
- Synchronising a branch other than the track; detached-HEAD moves; any change to D2.
- A second status for "the checkout was moved outside viburnum"; off-track is the signal.
- Changing the meaning of the direction arrows or the `sync` plan.

## Acceptance checks

| # | Trigger | Expected result | Observed by | Result |
|---|---|---|---|---|
| 1 | Fixture: clean checkout on `dev`, track `main`, remote ahead | status `off-track`, dot orange, `behind` still counted, the page's *pullable* count excludes it | status test | **pass** — `a checkout on another branch is off-track, not pullable`; `dotFor(off-track)` is orange |
| 2 | Fixture: same checkout with one dirty file | status `dirty`, not `off-track` (gate order) | status test | **pass** — same test, dirty row assertion |
| 3 | Fixture: no track, or checkout on its track | statuses unchanged: `current`, `remote-ahead`, `dirty` | existing status tests | **pass** — all status tests green; same test covers on-track and no-track rows |
| 4 | Fixture: sync-all with the own package mounted | `skipped` names the own package; `results` still excludes it; tool and CLI text print the skip note | core test, tools test | **pass** — `sync over all bundles skips viburnum itself` asserts `skipped`; the batch render test asserts *not synced: dsh-plugin-viburnum — it updates itself (D12)* |
| 5 | Fixture: hygiene scan of an off-track checkout with its track supplied | one `off-track` finding naming the branch and the track, with a switch suggestion | hygiene test | **pass** — `an off-track checkout is reported with its track`; the core hands the scanner the tracks (`hygiene hands the scanner every watched track`) |
| 6 | Any refusal result | the page banner reads `<bundle>: refused: <code> — <message>`; tool text keeps the bundle name | tools test | **pass** — batch render asserts `b: refused: dirty — 2 uncommitted files — commit or stash first` |
| 7 | Live check on this profile after a restart | an off-track/dirty bundle is flagged on Refresh, before any click | live page | **not run** — the running profile still serves 0.3.0; the change is live after a `dsh web` restart |
| 8 | `npm run check` | static checks and all suites green | command transcript | **pass** — `check: ok — 6 exports, 8 published entries`; `node --test` 165 tests, 0 failures (npm.ps1 is blocked by this machine's PowerShell execution policy, so the same gate ran as `node scripts/check.mjs` + `node --test`) |
