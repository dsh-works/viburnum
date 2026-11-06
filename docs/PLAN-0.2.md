# workbench page — plan delta

- **Tier:** feature on a released plugin (viburnum 0.1.0)
- **Revision:** 1
- **Branch:** `feature/workbench-page`, cut from `dev`
- **Parent plan:** [`PLAN.md`](PLAN.md)
- **Approved by:** the repository owner on 2026-11-06

## Outcome

From the viburnum page, clicking a bundle opens its own page: the branch is the hero control, the
incoming changelog and the reload class are readable, and a track switch or an update can be started
from there without leaving the Harness.

## Surface

No new transport. The existing `/viburnum/action` route gains a `detail` action, and the page
switches its own view between the list and the detail; the `main` slot stays keyed `viburnum`.

- **Host:** `core.detail(name)` composes the existing git and version modules (branches, direction,
  incoming changelog, target/current version, reload class). It is a local read: it never fetches and
  never moves anything.
- **Browser:** the detail is a second view inside the same component; rows and the sidebar entry are
  untouched.

Rejected: a `main` key per bundle (the shell selects one page id, and the list is the entry point); a
second route pair (the page's transport already exists and is header-guarded).

## Non-goals for this delta

- Install doors, `vib new`, the organisation catalog, timeline and hygiene — each is its own 0.2
  feature.
- "Opens" actions (folder, README, CHANGELOG, terminal): they need the Host open-in-app or terminal
  seam, and belong to the next delta.
- Tags and detached commits in the branch picker; branches only.

## Acceptance checks

| # | Trigger | Expected result | Observed by | Result |
|---|---|---|---|---|
| 1 | Click a bundle name on the viburnum page | the detail view opens; `Back` returns to the list with rows intact | live page | not run |
| 2 | Open the branch picker and choose `dev` or `main` | the checkout switches track, and the detail reloads on the new branch | live page + `git branch` | not run |
| 3 | Open a bundle that is behind | direction, incoming changelog (capped), target version and reload-class sentence are shown | live page | not run |
| 4 | Open a missing or unreadable checkout | a readable error is rendered, not a crash | live page | not run |
| 5 | `npm run check` and the `detail` route | core detail tests pass; `POST /viburnum/action {"action":"detail"}` answers JSON for a mounted bundle | command transcript | **partial** — 79 tests pass locally; the route is exercised live after the post-merge reload |
| 6 | Theme and accessibility | detail renders in light and dark; the branch control has an accessible name; no `slot entry crashed` in the console | live page + DevTools | not run |

## Risks and unknowns

| Risk | Cheapest experiment |
|---|---|
| Chrome log length makes the page heavy | the changelog is capped at 16 KB and scrolls in a bounded `<pre>`; verify with the largest real changelog. |
| Detail is stale between checks | it is a local read of the last fetch; the list's `Refresh` is the update path. Say so in the page copy if it confuses. |
| A switch started from the detail leaves the page on a dead view | after a move the detail is re-fetched by name; verify against a fixture branch. |
| Page remembers the list only | acceptable for 0.2; a page refresh returns to the list. |

## Verification plan

- Unit: `core.detail` against the fixture world (branches, direction, changelog, reload class,
  unknown bundle); `npm run check`.
- Live: after approval and reload, open the page, open one bundle, change **no** branch on a real
  checkout in the same run; light/dark and console check; ask the user for the visual confirmation.
- Not run: a real track switch from the live detail (needs the user's checkout and a clean tree).

## Open questions

| Question | Blocks | Owner |
|---|---|---|
| Which seam for "opens": `openInApp` vs a terminal in the directory? | next delta | build step |
| Should the detail also list local-ahead commit subjects, not just the count? | detail polish | user, if wanted |
