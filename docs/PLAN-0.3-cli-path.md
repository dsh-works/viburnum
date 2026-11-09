# CLI on PATH — plan delta

- **Tier:** feature on a released plugin (viburnum 0.2.2), target **0.3.0** (unreleased on `dev`)
- **Revision:** 2
- **Branch:** `feature/cli-path`, cut from `dev`
- **Parent plan:** [`PLAN.md`](PLAN.md); design D13/D19 (desktop actions), D24 (state with the profile)
- **Approved by:** the repository owner on 2026-11-09 ("ok lets do 1. and 2. i like it"), release target
  0.3.0. Revision 2 (in-page confirmation instead of `ctx.approval`) approved by the owner on
  2026-11-09 after the harness constraint was found.

## Outcome

The page can answer "is the `vib` command available in my terminal, and if not, make it so?" without
leaving the GUI. **Settings → viburnum** gains a **Command line** card that reports the real state —
available (with its path), linked but not on PATH, or missing — and offers **Install `vib` command**,
**Copy PATH line**, **Check again** and **Remove**. While the command is missing, a one-time,
dismissible notice on the viburnum page points at the card.

## Decisions

| Question | Decision |
|---|---|
| Mechanism | **`npm link` in the plugin checkout** (writes the npm global-prefix bin). No shell-rc edits, no sudo, no second install path. |
| Status facts | Three independent facts: (a) a `vib` shim exists in the npm global bin; (b) it resolves into **this checkout** (ours vs foreign); (c) the user's shell actually resolves `vib`. (a)+(b) → linked; (c) → available. |
| Any terminal on macOS | Install writes the shim once; any zsh/bash/sh/fish terminal whose PATH contains the npm prefix bin finds it. Detection probes the user's `$SHELL` (`-ilc`, then `-lc`, then `/bin/sh -lc`), not the Host's own PATH, because a GUI-launched Host has a narrower PATH. |
| PATH fallback | When the shim exists but the shell cannot find it, the card shows a **copyable** platform line (`export PATH="<prefix>/bin:$PATH"`; on Windows the `%APPDATA%\npm` equivalent). Never applied automatically. |
| Consent | `Install`/`Remove` are Host actions behind an **explicit in-page confirmation** (`Run`/`Cancel`), and the action requires `confirm: true`. The harness `approval` service is turn-bound (it needs an open model turn and an agent, and its `never` policy rejects by default), so a Settings button cannot route through it; the page confirmation is the consent. Copy writes nothing. |
| Revision note | Rev 1 proposed `ctx.approval`; revised after confirming the service rejects requests without an open turn. |
| Remove | Only when the global link resolves into this checkout; `npm unlink -g dsh-plugin-viburnum`; a foreign `vib` install is never touched. |
| Notice | Shown when status is not-available: **Install**, **Later** (hidden for this page load), **Don't show again** (persisted in the profile state, a new saved setting). |
| Packaging fix | Commit the exec bit on `bin/vib.js` (`100644` → `100755`), so `./bin/vib.js` works and the shebang is honest. |
| English first | New UI strings join the existing client string table; no new locale file. |

## Surface

- **Host:** new `lib/cli.js` — pure builders/parsers (npm prefix bin per platform, shim names, shell
  probe commands, PATH line, copy text) plus spawn seams; a guarded action `cli` with sub-commands
  `status | install | remove`; `index.js` injects the checkout directory and the approval service.
  Status is read on demand — it is not cached in the state file (the machine can change outside the
  GUI).
- **Browser:** Settings → viburnum **Command line** card; the one-time notice on the main page.
- **State:** one new saved setting for the notice dismissal (`cliNotice: 'show' | 'dismissed'`).
  Nothing else persists about the CLI.

## Non-goals

- Editing `~/.zshrc`/`~/.bashrc`/PATH automatically; sudo; installing or removing anything outside the
  npm global bin; publishing `vib` to a registry; an embedded terminal; removing an install we did not
  create; verifying every shell flavor we cannot probe (we probe the user's own `$SHELL`).

## Risks and unknowns

- **GUI vs terminal PATH** — the whole reason status is probed through the user's shell; if the probe
  itself fails, the card reports the shim facts and the copy line instead of claiming "missing".
- **nvm** — the global link lives under the active Node version; switching versions loses it. The
  card says so, and `Install` re-runs against the active version.
- **npm missing** — report `npm-unavailable` and fall back to the copyable direct invocation
  (`node <checkout>/bin/vib.js`).
- **Approval unavailable** — `Install`/`Remove` fail closed with a readable message (approvals are
  auto-rejected in the current session, so this is exercised here).
- **Windows** — `npm link` writes `vib.cmd`/`vib.ps1` into `%APPDATA%\npm`; detection uses `where`.
  Unit-tested through injected spawn/platform; no Windows machine is available for a live check.

## Acceptance checks

| # | Trigger | Expected result | Observed by | Result |
|---|---|---|---|---|
| 1 | CLI missing | Settings card says not available with Install and copy-PATH-line actions; page notice appears once | live GUI | **pass (live)** — missing card + notice rendered; **Later** hid it for the page load and it returned after a reload |
| 2 | Install | in-page confirm; `npm link` runs in the checkout; card flips to "available at `<path>`"; `command -v vib` works in zsh, bash and sh on this Mac; notice disappears | live GUI + real terminals | **pass (live)** — confirm → Run → `npm link`; notice gone; `command -v vib` in zsh/bash/sh; `vib --help` runs |
| 3 | Shim exists, shell PATH lacks the bin | card shows linked-but-not-on-PATH and the copyable `export PATH=…` line | fixture test | **pass** — `a link the shell cannot see offers the PATH line` |
| 4 | Remove | in-page confirm; only when the link resolves into this checkout; card returns to missing; a foreign `vib` is untouched | fixture test + live | **pass (fixture)** — `remove refuses a foreign install`, `remove unlinks our own install`; live not run — the ownership fix needs the next reload before Remove renders |
| 5 | Notice dismissal | Later hides for the page load; Don't show again persists across reload; no notice when available | live GUI | **pass (live, partial)** — Later per page load; the dismissal setting persists through the settings route; the Don't-show-again button was not clicked live |
| 6 | Cross-platform | POSIX and Windows prefix/shim/probe/PATH-line builders unit-tested from one Host; CI green on ubuntu, macOS, Windows | unit test + CI | **pass (unit + CI)** — 11 tests; CI green on all three at `b46189f` |
| 7 | Write boundary | only the npm global bin (via `npm link`, after the in-page confirm) and the profile state (dismissal) change; no shell rc is touched | code review + helper test | **pass (review)** — the actions only spawn npm; no rc write exists in the code |
| 8 | Gate | `npm run check` green; CI green on all three platforms | command transcript | **pass (local + CI)** — 161 tests, 0 failures; CI green |

## Verification plan

- **Unit:** `lib/cli.js` with injected `platform`/`spawn`/`npm` seams — POSIX and win32 status shapes,
  shim detection/ownership, copy line, install/remove command gating, notice setting validation; a
  route-level test through `lib/web.js` action dispatch.
- **Live:** after the profile reload (user decision): Settings card, notice, a real `npm link` on this
  Mac, `command -v vib` in iTerm/Terminal/zsh/bash/sh, then Remove; screenshots in light and dark.
- **Not run, and reported as such:** a Windows live run; a non-zsh/fish shell on this Mac if absent;
  every terminal app on macOS (the command is shell-agnostic, the check uses the user's shell).

## Open questions

- Release target: 0.3.0 (unreleased on `dev`) unless the owner prefers a separate 0.4.0.
- Windows copy line wording: `%APPDATA%\npm` is on PATH for default npm installs; if not, the card
  shows the `setx` equivalent as copy text only.
