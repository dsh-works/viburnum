# 0.2.0 release evidence (2026-11-09)

One page that records what was actually observed for the 0.2.0 deltas. The per-delta plans remain the
planning record; this file is the release's acceptance index.

| Area | Check | Result |
|---|---|---|
| Gate | `npm run check` | **pass** — 121 tests, 0 failures |
| Workbench detail | open a row, see branch/target/current versions, incoming changelog and reload class | **pass (visual)** — repository owner confirmed the page |
| Detail controls | branch switch / Update / Sync / Revert re-fetch the detail | **pass (route/unit)** — `detail` action exercised; a live track switch was not run |
| Opens | folder opens in the desktop | **pass (route)** — `open` accepted the path; UI button not separately clicked |
| Inline docs | README/CHANGELOG render as Markdown; missing file refuses | **pass (visual + unit)** — route/document tests and owner visual pass |
| Versions | own version in the header, plugin versions row/detail | **pass (route)** — status rows carry `version` |
| Icons | each row shows its manifest icon | **pass (route + visual)** — SVG/PNG data URIs in `/viburnum/status` |
| Sidebar | aggregate `↑ahead ↓behind` at the row's right edge | **pass (visual, preview commit)** — owner confirmed the preview |
| Install doors | directory links, repository clones into the shelf, refusals | **pass (route/CLI/unit)** — refusals exercised live; a real new install was not run |
| Browse | native Host folder dialog fills the path | **not run** — needs the desktop dialog |
| Organisation | catalog reads configured owners, caches, refreshes | **pass (live)** — `dsh-works` returned 3 repositories; install from it not run |
| `vib new` | scaffold + generated test + `--git` | **pass (live)** — demo bundle created, generated test 2/2 |
| `vib install` | CLI posts to the guarded route | **pass (live)** — `.` reached the Host and returned `already-installed` |
| Timeline | moves/incoming appear then clear when read | **pass (unit + CLI)** — `vib log` empty after read |
| Hygiene | duplicates/unmerged/dirty findings; nothing deleted | **pass (live)** — 10 checkouts, 8 findings; CLI exit 3 |
| Settings | interval/startup/shelf saved and applied | **pass (route + visual)** — set/reset plus relative-path refusal |
| Drift | running DSH version and `engines.dsh` mismatch warnings | **pass (route/unit)** — running `0.2.2-rc.1` detected; all ranges accepted |

Explicitly not claimed: a real install of a brand-new plugin, a live track switch, light/dark theme
comparison, and the second machine.
