# Ideas

Future ideas that are **not planned** for the current line. Each needs a gate-0 kickoff and an
approved plan delta before any code; an entry here is not a commitment and does not block a release.

| Idea | Why it could matter | Why it is parked |
|---|---|---|
| **npm distribution** — publish the bundle as `dsh-plugin-viburnum` so it installs with `dsh plugin --profile web add dsh-plugin-viburnum`, and let `npm i -g dsh-plugin-viburnum` put `vib` on `PATH` | one-command adoption; registry installs are updatable through the plugin manager; a global install would make the Command line card unnecessary for published users | the org convention is `private: true` and "not published to npm" (shared skill; DESIGN §12), and SCOPE lists registry bundles as not planned. A plain `npm install` cannot register a DSH bundle — the plugin manager owns the profile — so this is a distribution decision plus a plan, not just `private: false` |

Owner decision 2026-11-10: keep npm distribution as a future idea; **not planned for `dev`** now.
