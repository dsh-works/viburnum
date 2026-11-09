# catalog enrichment — plan delta

- **Tier:** feature on a released plugin (viburnum 0.2.1) — released in **0.2.2** as catalog completion
- **Revision:** 1
- **Branch:** `feature/catalog-enrichment`, cut from `dev`
- **Parent plan:** [`PLAN-0.2.md`](PLAN-0.2.md), catalog section in `SCOPE.md`
- **Approved by:** the repository owner on 2026-11-09 ("plan it and we'll implement it, all sounds good")

## Outcome

The organisation door becomes useful for big orgs and for choosing before installing:

- Catalog rows show the plugin's **icon** (lazy, cached) next to its name, description and badges.
- A **Preview** action shows the repo's README as Markdown plus its manifest facts (name, version,
  description, `engines.dsh`) **without installing or cloning it**.
- Settings gains a **default organisation** and an editable **organisation list**, so the catalog does
  not need a profile-file edit to cover several owners.

## Surface

- **Host:** GitHub REST reads through the already-resolved token (env, else git's credential helper):
  `contents/package.json` (raw), `contents/<icon path>` (raw bytes → data URI, 200 KB cap),
  `readme` (raw, 200 KB cap). New guarded actions `catalog-icon` and `catalog-preview`; per-repo
  in-memory caches (icon 30 min, preview 10 min). Settings persist `catalogOwners` (override of the
  Loader list, validated) and `defaultOwner` (must be one of the effective owners).
- **Browser:** each catalog row is a selectable card with icon + name + private/archived badges +
  description and a **Preview** button; a preview panel renders the Markdown and manifest facts next
  to the list. The settings page gains the owners field (comma-separated) and the default-organisation
  picker; the organisation door opens on the default owner.
- Rejected: cloning a repo just to read `package.json`/README; enriching every row at once (lazy fetch);
  proxying README images (relative/private images stay unrendered in this delta).

## Non-goals

- Images inside READMEs (text/lists/tables/code/links render; images are left as links).
- Editing another machine's catalog list; any write to GitHub; repo creation.
- Sorting controls; the API's `updated` order stays.

## Acceptance checks

| # | Trigger | Expected result | Observed by | Result |
|---|---|---|---|---|
| 1 | Organisation door with several repos | every row shows an icon or a letter fallback, the description, and badges | live page | **pass (visual)** — owner confirmed the catalog rows |
| 2 | Click Preview on a private repo | README renders as Markdown and manifest facts show; nothing is cloned or installed | live page | **pass** — private `dsh-plugin-pip` preview returned `dsh-plugin-companion v1.3.0`, `engines.dsh ^0.2.1-rc.2`, 37 KB README; no clone |
| 3 | Large owner | catalog pages stay complete; icons load lazily and are cached | route JSON + network count | **pass (unit)** — pagination test walks 101 repos over two pages; icons are fetched per row and cached 30 min |
| 4 | Settings → owners field + default organisation | the field accepts a comma-separated owner list; the door opens on the default owner; bad names are refused | live page / route JSON | **pass (route + visual)** — `setSettings` accepts/refuses owners and default; the page was in the owner's visual pass |
| 5 | README over the cap | preview says truncated at 200 KB | unit test | not run — the cap is enforced in code, no oversized fixture test yet |
| 6 | `npm run check` | catalog helpers, settings validation and route wiring tests pass | command transcript | **pass** — 125 tests, 0 failures |

## Risks

| Risk | Mitigation |
|---|---|
| GitHub API quota on a big org | lazy per-row icon fetches, short-lived caches, only 2 calls per preview |
| Private README images | left as links in this delta; a proxy route is a later decision |
| A repo without a bundle manifest | icon falls back to a letter; preview still shows the README |
| Token scope cannot read a private repo | the route returns a readable `catalog-http` refusal per repo |
