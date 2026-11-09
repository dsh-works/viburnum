# workbench page — inline documents delta

- **Tier:** feature on a released plugin (viburnum 0.1.0), third delta of 0.2
- **Revision:** 1
- **Parent plan:** [`PLAN-0.2.md`](PLAN-0.2.md)
- **Approved by:** the repository owner on 2026-11-09 (asked for README/CHANGELOG inline, rendered as Markdown)

## Outcome

A bundle's README and CHANGELOG open **inside** the viburnum detail view, rendered as Markdown
(headings, lists, tables, code, links), and the incoming changelog on the same view is Markdown too —
no external editor for documents. Only the folder keeps an external opener.

## Surface

- **Host:** `core.readDocument(name, target)` reads `README.md` / `CHANGELOG.md` from the mounted
  checkout only, capped at 48 KB, returned by the guarded `/viburnum/action` route (`document`).
- **Browser:** a small, safe Markdown → React renderer in `client.js` (no HTML injection; React
  escapes every text node), theme-token styled. The detail view gains README / CHANGELOG buttons and
  a document panel; the incoming-changelog block renders through the same renderer.
- Rejected: an iframe or external Markdown library (no dependencies, no iframe); `dangerouslySetInnerHTML`
  (unsafe for repository content).

## Non-goals for this delta

- Editing documents; syntax highlighting; images inside Markdown; nested lists beyond one level.
- Opening README/CHANGELOG in an external editor (the folder opener remains).

## Acceptance checks

| # | Trigger | Expected result | Observed by | Result |
|---|---|---|---|---|
| 1 | Click `README` in a bundle detail | the README renders inline as Markdown; headings, lists, tables and code are styled | live page | not run |
| 2 | Click `CHANGELOG` | the CHANGELOG renders inline; a repo without one shows a readable refusal | live page | not run |
| 3 | Incoming changelog | rendered as Markdown, not a raw `<pre>` | live page | not run |
| 4 | Unsafe Markdown | raw HTML and `javascript:` links are shown as text, never executed | unit sanity + live | not run |
| 5 | Oversized document | truncates at 48 KB and says so | unit test | not run |
| 6 | `npm run check` | core document tests pass | command transcript | **pending** |

## Risks and unknowns

| Risk | Cheapest experiment |
|---|---|
| A pathological Markdown file hangs the page | capped at 48 KB before rendering; parser is linear over lines. |
| Raw HTML in a README | never injected as HTML; shown as text. |
| Table/list edge cases | basic GitHub-flavoured subset only; extend on demand. |

## Open questions

| Question | Blocks | Owner |
|---|---|---|
| Syntax highlighting for code fences? | polish | next delta |
| Render images referenced by relative paths in a README? | polish | next delta |
