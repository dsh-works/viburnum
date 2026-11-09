# workbench page — install doors delta

- **Tier:** feature on a released plugin (viburnum 0.1.0), fourth delta of 0.2
- **Revision:** 1
- **Parent plan:** [`PLAN-0.2.md`](PLAN-0.2.md)
- **Approved by:** the repository owner on 2026-11-09 ("alright lets do it")

## Outcome

The page can **adopt a plugin**, not only watch what the profile already links:

- **Directory door:** enter an absolute checkout path → validate the manifest → `pluginManager.installBundle(path)`
  → the profile records `link:<absolute path>` and the bundle appears in the table (D13, D19, D22).
- **Repository door:** enter `owner/repo`, a GitHub URL, or an https/ssh git URL → clone into the shelf
  (`pluginsDir`, default `$DSH_HOME/viburnum/plugins`) → link the fresh checkout through the same
  directory path (D22).
- Refusals are readable and never destructive: `invalid-directory`, `missing-directory`, `not-a-package`,
  `not-a-bundle`, `already-installed`, `inspect-failed`, `install-failed`, `invalid-repository`,
  `shelf-collision`, `clone-failed`, `install-unavailable`.

## Surface

- **Host:** `core.installDirectory(path)` and `core.installRepository(input)`; injected collaborators
  `installer` / `inspector` come from the `pluginManager` service and `cloner` is the existing git seam
  (`git clone -- <url> <shelf>/<name>`, bounded at 120 s, no shell). New route action `install`
  on the guarded `/viburnum/action` pair.
- **Browser:** an `Install` button on the list opens a two-door form (directory path or repository
  URL); the result banner reports `installed <name> v<version>` or the refusal code. In directory
  mode a **Browse…** button asks the Host for a native folder dialog and fills the path field with
  its absolute choice (typed paths keep working; Cancel leaves the field untouched).
- **CLI:** `vib install <path|url|owner/repo>` is the directory/repository door from a terminal. The
  CLI has no plugin manager, so it posts to the running Host's guarded install action and prints the
  same receipt/refusal; the origin comes from `--host`, `$VIBURNUM_HOST`, `$DSH_WEB_URL`, else
  `http://127.0.0.1:3080`. `.` resolves to the current directory (D20).
- **Shelf:** `pluginsDir` configuration is honoured; a free shelf slot is created, an occupied slot is
  never overwritten (`shelf-collision`). An already-linked checkout is refused, never re-linked.

## Non-goals for this delta

- The **organisation door** (list repositories for `catalogOwners` and pick one) — next slice; it
  reuses `installRepository` after the catalog read.
- `vib install .` and the three-door CLI spelling — a CLI follow-up (the CLI has no plugin-manager
  service; it will go through the same guarded route or the harness CLI).
- Version exemptions, build-script approval, and registry specs: the plugin manager owns those
  policies and this delta surfaces only `failed`/`cancelled`.
- Removing bundles; moving inherited checkouts (D22 keeps them in place).

## Acceptance checks

| # | Trigger | Expected result | Observed by | Result |
|---|---|---|---|---|
| 1 | Page → Install → Directory → a real linked checkout path | `installed <name> v<version>`; a new row appears and the list refreshes | live page | not run |
| 2 | Page → Install → Repository → `owner/repo` | clone appears under the shelf, then a linked row appears; banner says cloned | live page + filesystem | not run |
| 3 | Bad paths and specs | `missing-directory`, `invalid-repository`, `not-a-bundle`, `shelf-collision` refusals with no profile change | live page / route JSON | not run |
| 4 | Already-linked checkout | `already-installed` refusal; the existing row is untouched | route JSON | not run |
| 5 | Directory mode → **Browse…** | the Host opens its native folder dialog; a choice fills the path field, Cancel leaves the typed value alone, and a Host without a picker reports `browse-unavailable` | live page | not run |
| 6 | `vib install .` / `vib install owner/repo` with the Host running | the CLI posts the right door and prints `installed …`; a refusal exits 1; no Host → a clear “cannot reach” error | command transcript | not run |
| 7 | `npm run check` | core install-door tests pass, suite green | command transcript | **pending** |

## Risks and unknowns

| Risk | Cheapest experiment |
|---|---|
| A clone into an occupied or unexpected shelf path | existence is checked before clone; collision is refused with the path. |
| A failed install leaves a half-clone | pnpm restores its manifest; the clone stays on disk (the plugin manager's own policy for downloaded files). The refusal names the repository and path. |
| Cloning needs credentials | the git seam runs with `GIT_TERMINAL_PROMPT=0`; a refused clone reports `clone-failed`. |
| Installing executes Host code | the plugin manager's own protections apply; the page reports its failure rather than bypassing it. |

## Open questions

| Question | Blocks | Owner |
|---|---|---|
| Organisation door: GitHub API via token from the credential store, cached under the profile? | next slice | build step |
| Should a clone that fails to install be removed automatically? | next slice | user |
| CLI install: same route over HTTP, or the harness `dsh plugin add`? | CLI follow-up | build step |
