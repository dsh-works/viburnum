# PAM — plugin auto manager

A pull button for your own DeepSeek Harness plugins. PAM watches the clones your profile is linked
to, fetches them, and fast-forwards each one to the head of the branch it follows — one click, and
the work machine is running what the laptop pushed last night.

It is built for one person's workshop: three plugins today, more later, two machines, no marketplace,
no other users to design around.

```
laptop                                 work machine
edit → commit → push   ──────────────▶  Update all → fetch → fast-forward → reload

PAM never pushes. It only pulls, keeps a receipt, and tells you when a night has not been pushed yet.
```

Each bundle follows a **track** — `main`, or `dev` while you are trying something — and moving between
tracks is the same button with a different branch. An update is a fetch and a fast-forward in the
linked directory, so there is no pnpm run, no lockfile write, and no profile edit.

**Status: design.** There is no code here yet. [`DESIGN.md`](DESIGN.md) carries the premise, the
decisions and the v0 cut. The short version: the one failure PAM cannot fix — work still sitting on
the other machine — is the one it names out loud.

House rules: private by default, MIT when it ships, `npm run check` is the gate, `node:*` before a
dependency, no telemetry, writes stay inside the workspace.
