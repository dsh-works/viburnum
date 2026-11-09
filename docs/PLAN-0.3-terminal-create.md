# terminal opener and repository creation — plan delta

- **Tier:** feature on a released plugin (viburnum 0.2.2), for **0.3.0**
- **Revision:** 1
- **Branch:** `feature/terminal-create`, cut from `dev`
- **Parent plan:** [`PLAN.md`](PLAN.md); design D13/D19/D20/D21, "the next things" §11
- **Approved by:** the repository owner on 2026-11-09 ("alright, lets build both of them")

## Outcome

- **Terminal opener**: a bundle's workbench gets a **Terminal** action that launches the Host
  desktop's terminal already in that checkout, closing the inspect → fix → sync loop (especially for
  the Guide conflict exit).
- **Repository creation**: `vib new <name> --push --org <owner>` scaffolds the bundle, creates the
  GitHub repository in that organisation (or the user's account), and pushes the first commit to
  `main` — so starting a plugin no longer needs a manual GitHub detour.

## Decisions

| Question | Decision |
|---|---|
| Terminal flavour | **OS terminal** for 0.3: Windows Terminal (fallback PowerShell), macOS Terminal via osascript, Linux x-terminal/gnome-terminal. An Agent-owned harness PTY needs a session picker and is deferred. |
| Creation confirmation | Explicit CLI flags are the confirmation: `--push --org <owner>`; **private by default**, `--public` opts out; no deletion path exists. |
| Post-create install | Not automatic; the next step prints `vib install <owner>/<repo>` (the organisation door). |

## Surface

- **Host:** `lib/terminal.js` (pure command builder + spawn with platform fallbacks, no shell string
  from user input); route action `terminal` resolves the bundle directory through `openTarget` and
  launches it. `lib/create.js` (`createRepository` via `POST /orgs/<owner>/repos`, fallback
  `POST /user/repos`; `publishScaffold` commits, sets origin and pushes `HEAD:main`). CLI gains
  `vib new --push --org <owner> [--public] [--description <text>]`; the token is `$GITHUB_TOKEN` /
  `$GH_TOKEN` or git's own credential helper.
- **Browser:** a **Terminal** button next to Folder in the workbench's open row.
- Rejected: a harness PTY in this delta; hiding the created repository on a failed push (it exists and
  the failure is reported instead); auto-installing after creation.

## Non-goals

- Repository deletion, renaming, or settings changes; git hosting other than GitHub.
- Installing the new repository automatically; the organisation door does that next.
- An embedded terminal panel.

## Acceptance checks

| # | Trigger | Expected result | Observed by | Result |
|---|---|---|---|---|
| 1 | Terminal action on a bundle | the desktop terminal opens in that checkout | live page | not run |
| 2 | `vib new demo --push --org dsh-works` | repository created (private), first commit pushed, next step printed | live command | not run — needs a real repository creation, deferred to the owner |
| 3 | Creation refused (bad owner/exists/permission) | readable `create-http` failure; no push attempted | stubbed API test | not run |
| 4 | Push fails after creation | the repository is reported as created and the push error is printed; nothing deleted | unit test (publish failure path is exercised by a local bare origin) | not run |
| 5 | `npm run check` | terminal and create suites green with the rest | command transcript | **pending** |
