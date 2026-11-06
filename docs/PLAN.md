# viburnum — plan

- **Repository:** `dsh-works/viburnum` — deliberate deviation from the skill's `dsh-plugin-<slug>`
  repository convention, decided at gate 0 (package and row follow the convention). Precedent:
  `dsh-fren` hosts `dsh-plugin-companion`.
- **Row id:** `viburnum`
- **Package name:** `dsh-plugin-viburnum`
- **Client module id:** `dsh-plugin-viburnum` · **locale namespace:** `dsh-viburnum`
- **Harness range:** `engines.dsh` `^0.2.1-rc.2` — verified against live `0.2.2-rc.1`: app-boot
  matches with `includePrerelease: true`, and the two installed plugins use the same range.
- **Tier:** new plugin
- **Revision:** 2
- **Date:** 2026-11-06
- **Approved by:** the repository owner on 2026-11-06 (gate 1)

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

**Page data path (G1) — settled live.** Out-of-tree bundles cannot add Typert `@Remote` endpoints or
remote events, and bundle client halves do not receive the dynamic-package `host.call` channel. The
implemented transport is a pair of same-origin JSON routes registered with
`ctx.webServer.register(...)` (`/viburnum/status`, `/viburnum/action`, both requiring
`x-viburnum: 1`), read by the client store via `fetch`. On 2026-11-06 the live browser half fetched
the route (`transport.clientSeenAt` with a Chrome user agent), so the probe passed end to end.

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
| 1 | `npm run check` | manifest, patch, locale shape, Host entry form, config validation and the git seam pass against fixtures | command transcript | **pass** 2026-11-06 — 78 tests, 0 failures |
| 2 | Install into a profile | `dsh plugin --profile web add <path>` succeeds without warnings; row `viburnum` active in `--dump-config` | command + Plugins page | **pass** 2026-11-06 — `plugin_manager.installBundle` returned `application: applied` with no warnings; profile dependency and bundle row present |
| 3 | Open the Web UI | row above Plugins with butterfly + dot; click opens the viburnum page; console clean; readable in light and dark | screenshots + DevTools | **partial** — `sidebar.panellist` occupant `viburnum` at order −10 before `plugins`, `main` occupant `viburnum` active, and the browser client fetched `/viburnum/status`; visual light/dark screenshots **not run** |
| 4 | Fixture world: bare origin, two clones, commits on both sides | status, dot and arrows match `git rev-list --left-right --count` for current, remote-ahead, local-ahead and diverged; precedence red > orange > violet > grey > green | page text + `vib status --json` | **pass (fixtures)** — status tests cover every state and the dot precedence; live: three mounted rows current, dot green |
| 5 | Update a fast-forwardable clone | fast-forward only; refuses non-ff; receipt records both heads; `vib revert` restores the snapshot | CLI transcript + state file | **pass (fixtures)** — update and revert tests; a live move on a user checkout **not run** |
| 6 | Sync both directions | push-only pushes; pull-only fast-forwards; private divergence rebases then pushes; receipt counts pushed/pulled/rebased; never force | CLI transcript + origin log | **pass (fixtures)** — push/pull/private-rebase/published-refusal tests; the real two-machine check **not run** |
| 7 | Refusal paths | dirty blocks update/sync/switch with the command; detached blocks sync and lists branches; published divergence refuses with both lists; conflict aborts (no rebase left) and names files | CLI transcript + `git status` | **pass (fixtures)** — dirty, detached, published-divergence and conflict-abort tests |
| 8 | Track switch, revert and restart | `main`↔`dev` switch (including creating a local branch from a remote-only track), reload class reported, receipt recorded, revert restores; per-machine state survives a restart | page + state file | **pass (fixtures)** — switch/revert/track-persistence tests; a live switch and a profile restart **not run** |
| 9 | Agent tools in a session | `vib_status` reads cache with no network or writes; `vib_update`/`vib_sync` ask approval and apply; invalid bundle id returns a typed error | session transcript | **partial** — `vib_status` live, `vib_sync --dry-run` exercised through the page route, approval refusal covered by tool tests; an approval prompt end to end **not run** (answerer disabled) |
| 10 | Invalid config | bad `checkIntervalMinutes` fails the load with an actionable message; a valid edit is honoured after reload | console + `--dump-config` | **partial** — schema validation tests pass; a live invalid-config load **not run** |
| 11 | Locale and theme | `locale/en.json` and `locale/zh.json` carry non-empty `meta.title`/`meta.description`; client copy comes from the locale service; no hardcoded UI strings; only `--dsw-alias-*` tokens | source + UI in en/zh, light/dark | **partial** — locale files, key parity and the client dictionaries are checked; live Chinese copy and light/dark **not run** |
| 12 | Self-update | `Sync all` skips viburnum's own row; `Update viburnum` moves files and reports `restart-required` | simulated fixture + live check | **not run** — own-row skip is covered by a fixture test; `Update viburnum` was not moved |

## Gate 3 evidence (2026-11-06)

- `npm run check` — 78 tests, 0 failures (30 s).
- Install: `plugin_manager.installBundle` on the linked directory returned `application: applied`,
  no warnings; `package.json` and `dsh.profile.bundles` gained `dsh-plugin-viburnum`.
- Live tools: `vib_status` returned the three mounted bundles (`dsh-plugin-alerts`,
  `dsh-plugin-pixelart`, `dsh-plugin-viburnum`), each `current`, dot green, checked timestamp.
- Host route: `GET /viburnum/status` returned `200` with rows and config;
  `POST /viburnum/action` answered `refresh`, `tracks` and `sync { dryRun: true }` correctly.
- Client transport: the status response carried `transport.clientSeenAt` and a Chrome user agent,
  so the browser half ran and fetched the route.
- Client slots: `sidebar.panellist` occupants `viburnum` (order −10), `plugins` (0), `schedules` (10);
  `main` occupants include `viburnum`, active.
- CLI: `node bin/vib.js status` printed the same three rows and exited 0.
- State: `$DSH_HOME/profiles/web/.viburnum/state.json` (`version: 2`).
- Timeout: one live fetch hit the 20 s bound and was reported as a timeout with no stuck request;
  `vib status` still answered from cache.
- Not run: visual light/dark screenshots, Chinese UI switch, an approval prompt end to end, a live
  move on a user checkout, a profile restart, a real second machine.

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
| ~~Does the `webServer` route + client `fetch` transport work behind the Web carrier's auth and CSP?~~ **Resolved 2026-11-06:** yes — the browser half fetched `/viburnum/status`. | UI scope (G1 probe) | done |
| ~~Which profile directory is visible to a Host plugin?~~ **Resolved 2026-11-06:** the state landed in `~/.dsh/profiles/web/.viburnum/`; no fallback needed. | state path | done |
| Does a linked bundle's client half re-materialize on file change (O1), and with what banner wording? | reload copy | 0.2 |
| ~~Final glyph~~ **Resolved:** `blue-butterfly-dark.png` is the package icon; the sidebar glyph is the inline butterfly in `client.js`. | UI assets | done |
| `dsh-fren` rename: `dsh-plugin-pip` or `dsh-plugin-pipfren`? | 0.2 catalog display | separate repo, decide before 0.2 |
| Keep or delete `origin/spike/scaffold` after the local discard? | repo hygiene | defer to the user |

## Revision log

| Revision | Date | Change | Approved |
|---|---|---|---|
| 1 | 2026-11-06 | initial plan from DESIGN rev 6 and gate-0 answers: core-first 0.1.0, transport probe first, `spike/scaffold` discarded, profile state dir, repository kept as `viburnum`, fixtures-only verification | 2026-11-06 |
| 2 | 2026-11-06 | gate-3 evidence recorded after the live install; implementation matches revision 1, no scope change. Release candidate on `dev`; merge to `main` waits for the user's visual check. | 2026-11-06 |
| 3 | 2026-11-06 | Repository made public: MIT licence, community docs (CONTRIBUTING, SECURITY), personal paths and handles removed, brand lowercased to `viburnum`; no behaviour change. | 2026-11-06 |
