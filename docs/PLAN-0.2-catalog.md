# workbench page — organisation catalog delta

- **Tier:** feature on a released plugin (viburnum 0.1.0), fifth delta of 0.2
- **Revision:** 1
- **Parent plan:** [`PLAN-0.2.md`](PLAN-0.2.md)
- **Approved by:** the repository owner on 2026-11-09 ("continue with the rest")

## Outcome

The install form's third door lists the repositories of the configured GitHub owners
(`catalogOwners`, default `dsh-works`) and installs a picked one through the existing repository
door (clone into the shelf, then link). Successful catalog answers are cached for ten minutes and can
be refreshed by hand; a failing owner is reported in place and never hides the other owners.

## Surface

- **Host:** `core.catalog({ refresh, owners })` over an injected `catalogFetcher`; the index supplies
  `fetchOwnerRepos(owner)` from `lib/catalog.js`, which asks `GET /orgs/<owner>/repos`, falls back to
  `/users/<owner>/repos` for personal owners, follows pages up to 500 repositories, and sends
  `Authorization: Bearer` with `$GITHUB_TOKEN`/`$GH_TOKEN` or, when neither is set, the token git's own
  credential helper returns for `github.com` (read in memory only, never stored or logged). New route
  action `catalog` on the guarded action pair.
- **Browser:** the install form gains `Organisation`; it shows an owner picker, a `Refresh catalog`
  button, a filter box and a scrollable repository list (name, description, `private`/`archived`
  badges) instead of a dropdown; picking a row and pressing Install installs its `owner/repo` through
  the repository door.
- Cache is in-memory per Host process: 10 minutes for success, 1 minute for a failure.

## Non-goals for this delta

- Repository creation in the organisation (that is `vib new`/org creation, a later slice).
- Reading private repositories without a token in the environment; the unauthenticated GitHub rate
  limit applies.
- Persisting the catalog in the profile state (an in-memory cache is enough for 0.2).

## Acceptance checks

| # | Trigger | Expected result | Observed by | Result |
|---|---|---|---|---|
| 1 | Install → Organisation | the owner picker lists `catalogOwners`, the repository picker fills from GitHub, archived entries are marked | live page | not run |
| 2 | Pick a repository → Install | it clones into the shelf like the repository door, then appears as a linked row | live page + filesystem | not run |
| 3 | Refresh catalog | a new GitHub read replaces the cached list; failures show the owner's error in the hint line | live page / route JSON | not run |
| 4 | No token / offline GitHub | `catalog-http` / `catalog-network` reported per owner; the form keeps working | route JSON | not run |
| 5 | `npm run check` | catalog mapping, fallback and cache tests pass | command transcript | **pending** |
