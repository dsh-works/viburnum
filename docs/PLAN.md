# Viburnum — plan

- **Repository:** `dsh-works/viburnum` — deliberate deviation from the skill's `dsh-plugin-<slug>`
  repository convention, decided at gate 0 (package and row follow the convention). Precedent:
  `dsh-fren` hosts `dsh-plugin-companion`.
- **Row id:** `viburnum`
- **Package name:** `dsh-plugin-viburnum`
- **Client module id:** `dsh-plugin-viburnum` · **locale namespace:** `dsh-viburnum`
- **Harness range:** `engines.dsh` `^0.2.1-rc.2` — verified against live `0.2.2-rc.1`: app-boot
  matches with `includePrerelease: true`, and the two installed plugins use the same range.
- **Tier:** new plugin
- **Revision:** 1
- **Date:** 2026-11-06
- **Approved by:** Ivan on 2026-11-06 (gate 1)

## Outcome

On either machine, one sidebar row shows whether every linked plugin checkout is current, and one
page — or one `vib sync` — closes the loop in both directions, without the user remembering which
machine pushed last.

## Surface

Host bundle (`index.js`, `lib/`), one browser half (`client.js` plus chunks) registering a
`sidebar.panellist` icon and a `main` page keyed `viburnum`, the `vib_*` Host tools, and a standalone
`vib` CLI over the same core.

| Candidate | Fits? | Why not |
|---|---|---|
| Client-only bundle | No | Git inspection and mutation need the Host process; the browser cannot spawn git. |
| Host tools only | No | The glance — one dot, one page — is the product; tools answer only when the model asks. |
| Agent-preset placement | No | The tool serves the profile and every session, not one session's persona/tools. |
| Host bundle + page + tools + CLI | Yes | One core, three faces (D10); the sidebar and `main` page seams are verified in the live harness. |

**Page data path (G1).** Out-of-tree bundles cannot add Typert `@Remote` endpoints or remote events,
and bundle client halves do not receive the dynamic-package `host.call` channel. The planned transport
is a same-origin JSON route registered with `ctx.webServer.register(...)`, read by the client store via
`fetch` (poll or stream). A probe settles this before UI code is committed; if it fails, implementation
pauses and this plan is revised and re-approved.

## Non-goals (0.1.0)

- Install doors (directory, repository URL, organisation and shelf), the per-plugin workbench page,
  and `vib new` — all move to 0.2.
- Organisation catalog browsing, timeline, hygiene scan, `vib_brief`.
- Auto-update or any timer that changes state; every move stays a click or a command (D9).
- Commits, force-push, rebasing published commits (D5/D6).
- Registry bundles, multi-profile, notifications, diff stat, dependency installation.
- Live two-machine verification: 0.1.0 is accepted on offline fixture repositories only; the real
  cross-machine check is manual and reported as **not run** (gate-0 decision).
- Renaming `dsh-fren` — separate repository; tracked as an open question for 0.2 catalog work.

## Risks and unknowns

| Risk | Cheapest experiment that settles it |
|---|---|
| Host→page transport (G1) | Probe: Host `webServer.register` JSON route, page `fetch`/poll; observe dot update and a console free of `slot entry crashed`. |
| State location O2 — chosen: profile state dir (D11) | Probe logs `process.env.DSH_HOME`/`DSH_PROFILE`, `process.argv`, and `pluginManager.listBundles()` sources; if the profile dir is not discoverable, use the DESIGN O2 fallback `$DSH_HOME/viburnum/<profile>/` and record it. |
| `BundleInfo.source` shape for linked bundles | Probe logs the two current linked entries; normalize `link:`/`file:`/relative specs in one tested helper. |
| Published-divergence detection (D6) | Offline fixture with one commit already on a remote ref plus one private commit; test `git branch -r --contains` and `rev-list --remotes`. |
| Git child-process disposal (A3) | Fixture test: timeout kills **and awaits** exit, SIGKILL escalation, no zombie; the discarded spike's timeout bug is not reintroduced. |
| HMR vs restart banner wording (O1) | One throwaway commit with the page open: does the client re-materialize or only the page reload? Banner copy follows the answer; not blocking. |
| Tool approval UI (§5.2) | Probe tool calls `ctx.approval.request(...)` once in a session; observe the ask and the `allowed-once` outcome. |
| A profile restart ends this session | Verify in steps; coordinate the `dsh web` restart with the user and report `restart-required` honestly. |

## Acceptance checks (gate 3)

| # | Trigger | Expected result | Observed by | Result |
|---|---|---|---|---|
| 1 | `npm run check` | manifest, patch, locale shape, Host entry form, config validation and the git seam pass against fixtures | command transcript | not run |
| 2 | Install into a profile | `dsh plugin --profile web add <path>` succeeds without warnings; row `viburnum` active in `--dump-config` | command + Plugins page | not run |
| 3 | Open the Web UI | row above Plugins with butterfly + dot; click opens the Viburnum page; console clean; readable in light and dark | screenshots + DevTools | not run |
| 4 | Fixture world: bare origin, two clones, commits on both sides | status, dot and arrows match `git rev-list --left-right --count` for current, remote-ahead, local-ahead and diverged; precedence red > orange > violet > grey > green | page text + `vib status --json` | not run |
| 5 | Update a fast-forwardable clone | fast-forward only; refuses non-ff; receipt records both heads; `vib revert` restores the snapshot | CLI transcript + state file | not run |
| 6 | Sync both directions | push-only pushes; pull-only fast-forwards; private divergence rebases then pushes; receipt counts pushed/pulled/rebased; never force | CLI transcript + origin log | not run |
| 7 | Refusal paths | dirty blocks update/sync/switch with the command; detached blocks sync and lists branches; published divergence refuses with both lists; conflict aborts (no rebase left) and names files | CLI transcript + `git status` | not run |
| 8 | Track switch, revert and restart | `main`↔`dev` switch (including creating a local branch from a remote-only track), reload class reported, receipt recorded, revert restores; per-machine state survives a restart | page + state file | not run |
| 9 | Agent tools in a session | `vib_status` reads cache with no network or writes; `vib_update`/`vib_sync` ask approval and apply; invalid bundle id returns a typed error | session transcript | not run |
| 10 | Invalid config | bad `checkIntervalMinutes` fails the load with an actionable message; a valid edit is honoured after reload | console + `--dump-config` | not run |
| 11 | Locale and theme | `locale/en.json` and `locale/zh.json` carry non-empty `meta.title`/`meta.description`; client copy comes from the locale service; no hardcoded UI strings; only `--dsw-alias-*` tokens | source + UI in en/zh, light/dark | not run |
| 12 | Self-update | `Sync all` skips Viburnum's own row; `Update Viburnum` moves files and reports `restart-required` | simulated fixture + live check | not run |

## Verification plan

- Manifest and unit tests need no profile; the git-seam tests spawn child processes, so one
  host-approved unsandboxed run is required (this session's sandbox returns `spawn EPERM`).
- Install, host reload and restart need explicit user approval: installing executes bundle code in
  the Host process (J1), and a restart can end this session. Coordinate and report it.
- UI checks run in light and dark, in `en` and `zh`, with screenshots kept as evidence. No second
  machine is available, so cross-machine sync is **not run** and recorded in the README limits.
- Rollback: disable the row with `disabled: true`; remove with
  `dsh plugin --profile web remove dsh-plugin-viburnum`; state stays under the profile and is named
  in the README.

## Open questions

| Question | Blocks | Owner |
|---|---|---|
| Does the `webServer` route + client `fetch` transport work behind the Web carrier's auth and CSP? | UI scope (G1 probe) | build step 0 |
| Which profile directory is visible to a Host plugin (`DSH_HOME`/`DSH_PROFILE` vs fallback)? | state path | build step 0 |
| Does a linked bundle's client half re-materialize on file change (O1), and with what banner wording? | reload copy | build step 7 |
| Final glyph: `viburnum-butterfly` or `blue-butterfly-dark` for sidebar/page (dot drawn in-glyph)? | UI assets | build step 7 |
| `dsh-fren` rename: `dsh-plugin-pip` or `dsh-plugin-pipfren`? | 0.2 catalog display | separate repo, decide before 0.2 |
| Keep or delete `origin/spike/scaffold` after the local discard? | repo hygiene | after approval |

## Revision log

| Revision | Date | Change | Approved |
|---|---|---|---|
| 1 | 2026-11-06 | initial plan from DESIGN rev 6 and gate-0 answers: core-first 0.1.0, transport probe first, `spike/scaffold` discarded, profile state dir, repository kept as `viburnum`, fixtures-only verification | 2026-11-06 |
