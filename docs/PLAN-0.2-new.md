# workbench page — `vib new` delta

- **Tier:** feature on a released plugin (viburnum 0.1.0), sixth delta of 0.2
- **Revision:** 1
- **Parent plan:** [`PLAN-0.2.md`](PLAN-0.2.md)
- **Approved by:** the repository owner on 2026-11-09 ("continue with vib new etc")

## Outcome

`vib new <name>` writes a Host-only bundle that already satisfies the dsh-works taxonomy, so creating a
plugin stops being a memory test (D21): a manifest, a bundle patch row, an entry module, a test and a
README in one command, with an optional first git commit.

## Surface

- **CLI:** `vib new <name> [--dir <path>] [--git] [--json]`; names normalize into
  `dsh-plugin-<slug>` (lowercase letters, digits, inner hyphens; `Demo Plugin` → `dsh-plugin-demo-plugin`).
  It refuses a non-empty target directory. `--git` runs `git init`, `git add -A`, and one commit; a
  failed git step leaves the files in place and reports a warning. No harness, profile or network is
  needed.
- **Files:** `package.json` (private, ESM, `engines.dsh` copied from viburnum's own range,
  `dsh.bundle.patch`, test script), `cordis.patch.yml` (one insert row whose id is the slug),
  `index.js` (entry with `name` and `apply`), `test/plugin.test.mjs` (manifest/patch alignment),
  `README.md`, `.gitignore`.
- Rejected: writing a UI half by default (a Host-only bundle is the honest minimum); creating the
  GitHub repository or pushing (`--git` is local only); installing (`vib install .` is the separate door).

## Non-goals for this delta

- Organisation repository creation, `--push`, and template choices (UI bundle, tool bundle, service
  bundle) — later.
- Tagging or releasing the scaffolded bundle.

## Acceptance checks

| # | Trigger | Expected result | Observed by | Result |
|---|---|---|---|---|
| 1 | `vib new demo` | `dsh-plugin-demo/` contains manifest, patch, entry, test, README; stdout names the files | command transcript | **pass (live, 2026-11-11)** — six files written, stdout named them |
| 2 | `--git` | the bundle has `.git` and an initial commit; a git failure warns but keeps the files | command transcript | **pass (live, 2026-11-11)** — `Scaffold dsh-plugin-git-demo` commit present |
| 3 | `vib new demo` twice | the second run refuses with “already exists and is not empty”, exit 1 | command transcript | **pass (live, 2026-11-11)** — second run exit 1 with that message |
| 4 | The scaffolded test | `node --test test/plugin.test.mjs` inside the new bundle passes | command transcript | **pass (live, 2026-11-11)** — 2 tests, 0 failures |
| 5 | `npm run check` | identity, files, git, refusal and CLI tests pass | command transcript | **pass** — 161 tests, 0 failures; CI green on ubuntu, macOS and windows |
