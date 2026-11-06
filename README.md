# Viburnum

*A manager that Keeps All Linked Installs Neatly Synced In Two Universes.*

A workbench for your own DeepSeek Harness plugins: create them, mount them, choose which version runs,
and keep two machines in sync. It watches the clones your profile is linked to, and one click fetches,
pushes, fast-forwards or rebases each one onto the branch it follows — so both machines run the same code
without you remembering which one pushed last.

A row in the sidebar carries one dot: green when everything is current, blue when something can be
pulled, orange when work is uncommitted, red when it is unpushed. It also installs — from a directory,
from a repository URL, or from the repositories of a GitHub organisation.

Named after the shrub that holds its berries through the winter: in place, visible, current. The
command is `vib`; `viburnum` works too.

It is built for one person's workshop: three plugins today, more later, two development machines, no
marketplace, no other users to design around.

```
laptop ⇄ origin ⇄ work machine
             one click: fetch → ff | rebase → push → reload
```

Each bundle follows a **track** — `main`, or `dev` while you are trying something — and the track is
per machine, so the laptop can try `dev` while the work machine stays on `main`. Switching is the same
button with the other branch. An update is a fetch and a fast-forward in the linked directory, so
there is no pnpm run, no lockfile write, and no profile edit.

Viburnum never commits and never force-pushes. When a rebase would rewrite something already
published, it stops and shows both sides; when the rebase conflicts, it aborts and hands you the files.

**Status: design.** There is no code here yet. [`DESIGN.md`](DESIGN.md) carries the premise, the
decisions and the v0 cut. The short version: the thing that actually goes wrong — two histories
wearing the same version number — is the first thing the page shows.

House rules: private by default, MIT when it ships, `npm run check` is the gate, `node:*` before a
dependency, no telemetry, writes stay inside the workspace.
