# Plugin standards

This repository follows the DSH plugin development process and standards:

- Process and skill: <https://github.com/dsh-works/dsh-plugin-development>
- Authority: the `deepseek-harness` checkout and the live harness. Where this file, the skill, or any
  note disagrees with them, they win and the file is corrected.

## Project-specific rules

| Rule | Why it exists here |
|---|---|
| Package is `dsh-plugin-viburnum`, row id `viburnum`; the repository is `dsh-works/viburnum` rather than `dsh-plugin-viburnum`. | Gate-0 decision on 2026-11-06. The package and row follow the convention; the repository keeps the product name (precedent: `dsh-plugin-pip` hosts `dsh-plugin-companion`). |
| `main` is stable, `dev` is integration; work happens on `dev` or a `feature/<slug>` branch; a `hotfix/<slug>` cuts from `main` and merges back into both lines. | Profiles link a working tree, so the line that runs must be the line that was verified. A release merges `dev` into `main`, tags `v<version>`, and syncs `main` back into `dev`. |
| No runtime dependencies beyond `node:*`; no build step. | Keeps install a link and keeps every git call a bounded `spawn`. |
| The page reads the Host through the same-origin routes `/viburnum/status` and `/viburnum/action`, which require the `x-viburnum: 1` header. | Out-of-tree bundles cannot add Typert Remote endpoints; the routes are the only transport. The custom header keeps a cross-site form from acting. |
| viburnum's state lives in `$DSH_HOME/profiles/<profile>/.viburnum/state.json` and never in a bundle checkout. | D11; `git status` in every plugin stays clean, and the state survives reloads. Writes use temp file + rename. |
| Every move that writes outside the workspace asks `ctx.approval.request` first; a missing approver fails closed. | The tools act on the user's real checkouts; consent is part of the contract. |
| Verification is fixtures-first (`test/fixtures.mjs`: bare origin, two clones, conflicts). Cross-machine sync is a manual check and is reported as not run. | D14; no second network or second machine is available to the build. |
| `npm run check` is the local gate: static bundle checks plus `node --test`. | Matches the shared skill and the GitHub Actions workflow. |

## Local tooling

- `npm run check` — static manifest/patch/locale/client checks followed by the full test suite.
- `node --test test/*.test.mjs` — the same tests directly.
- `node bin/vib.js status` — the CLI against the current profile (reads `$DSH_HOME`/`$DSH_PROFILE`).

## Not duplicated here

Bundle shape, effects and disposal, config, session and model-visible data, errors, locale, tool
contracts, Web UI rules, packaging, compatibility, tests, and install trust live in the shared skill.
Do not copy them into this repository; a copy rots against the harness.
