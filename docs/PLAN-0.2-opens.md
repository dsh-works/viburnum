# workbench page — opens delta

- **Tier:** feature on a released plugin (viburnum 0.1.0), second delta of 0.2
- **Revision:** 1
- **Parent plan:** [`PLAN-0.2.md`](PLAN-0.2.md)
- **Approved by:** the repository owner on 2026-11-09 ("yup less go")

## Outcome

From a bundle's workbench detail, the user can hand its directory, README or CHANGELOG to the desktop
with one click, through the same verified native path opener the harness already uses.

## Surface

- **Host:** `core.openTarget(name, target)` resolves the path inside the mounted checkout only;
  the `/viburnum/action` route gains an `open` action that calls the existing
  `sessionController.openWorkspacePath({ path }, signal)` service — no new process spawner, no
  shell, no path outside the bundle.
- **Browser:** three buttons in the detail view's `open` row.
- Rejected: spawning Explorer/`xdg-open` from the plugin (the harness already has a verified native
  opener with desktop availability checks); a second route (the guarded action route is enough).

## Non-goals for this delta

- The terminal opener: `terminals.spawn` needs an exact Agent owner and the page is not
  session-bound; it stays a separate decision.
- Application choice: the OS default is used; the harness application picker is not reimplemented.
- Reveal-in-file-manager: opening the folder is the requested action.

## Acceptance checks

| # | Trigger | Expected result | Observed by | Result |
|---|---|---|---|---|
| 1 | Click `Folder` in a bundle detail | the checkout directory opens in the desktop file manager | live page | **pass (route)** — `POST /viburnum/action {"action":"open","bundle":"dsh-plugin-pixelart","target":"folder"}` returned `{ "opened": true }` and the desktop accepted the path; the button click itself is **not run** |
| 2 | Click `README` / `CHANGELOG` | the file opens in its associated application | live page | not run |
| 3 | Open a bundle without a CHANGELOG | readable refusal (`missing-file`), no crash | live page + route JSON | **partial** — `core.openTarget` returns `missing-file` in the fixture test; the live route was not exercised with a missing file |
| 4 | Route with an unknown target | `unknown-target` refusal, nothing opened | command transcript | **pass** — the live route returned `unknown-target` |
| 5 | Profile without a desktop opener | `open-unavailable` refusal | unit test / headless | not run |
| 6 | `npm run check` | core open-target tests pass, 80+ tests green | command transcript | **pass** — 81 tests, 0 failures |

## Risks and unknowns

| Risk | Cheapest experiment |
|---|---|
| A bundle path outside the desktop-verified roots | the opener verifies the path through the composed filesystem and refuses; verify against the real profile. |
| An opener failure is silent on the desktop | the route reports `opened: true` only after the opener accepted the path; a failure becomes a readable refusal banner. |
| A missing README/CHANGELOG on some repo | resolution checks the path first and returns `missing-file`. |

## Open questions

| Question | Blocks | Owner |
|---|---|---|
| Terminal opener: Agent-scoped PTY vs. an OS terminal outside the harness? | next delta | user |
| Should the detail offer the harness application picker instead of the OS default? | polish | next delta |
