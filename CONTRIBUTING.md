# Contributing

viburnum is open source under the [MIT licence](LICENSE). Issues and pull requests are welcome;
please read this before opening either.

## Before you start

- Read [README.md](README.md), [SCOPE.md](SCOPE.md) and [docs/PLAN.md](docs/PLAN.md). The shared
  process lives in [dsh-plugin-development](https://github.com/dsh-works/dsh-plugin-development) —
  it is the rulebook this repository is built against.
- Check the harness version you are testing against (`dsh --version`). The bundle declares
  `engines.dsh ^0.2.1-rc.2`; the APIs are a developer preview.
- Nothing here requires a build step, and the runtime has no dependencies beyond `node:*`.

## Branches

- `main` is the stable line; `dev` is where work lands.
- Cut `feature/<slug>` from `dev`; cut `hotfix/<slug>` from `main` and merge it into both lines.
- Send pull requests to `dev`. `main` receives merge commits from `dev` and hotfixes only.
- Never force-push `main` or `dev`.

## The gate

```powershell
npm run check
```

That is the static bundle checks plus the full `node --test` suite (78 tests at 0.1.0). It must be
green. The tests use real fixture git repositories under the operating system temp directory; no
network and no harness are needed.

If you change behaviour, change the tests and the README in the same pull request. The README's
**Limits** and **Verification** sections are part of the deliverable, not a footnote.

## Rules that are easy to miss

- Keep the Host half plain ESM and the browser half a classic script (`client.js` has no `import`,
  `export`, or top-level `await`).
- Every registration goes through `ctx.effect`/`ctx.on`; unloading must leave nothing behind.
- No Harness Client package is imported at runtime; style only with `--dsw-alias-*` tokens.
- Every user-visible string comes from the locale service; ship `en` and `zh` copy.
- Moves that write outside the workspace ask `ctx.approval.request` first; a missing approver fails
  closed.
- Do not add a runtime dependency without a real reason; `node:*` first.

## Reporting bugs

Include the commit or version, the harness version, your operating system, and the exact command or
click that went wrong. For a failed move, include the banner text and, if possible, the output of
`vib status --json` — it carries the row statuses and directions.

Security issues: see [SECURITY.md](SECURITY.md).
