# PAM — plugin auto manager

A DeepSeek Harness bundle that notices when an installed plugin bundle has a new tag, shows you what
changed, and moves the profile onto it.

The gap it fills: a bundle here is a directory you cloned once and then stopped thinking about.
`plugin_manager` can install, remove and enable a bundle, and `plugin_market` lists what a registry
offers — but nothing watches the code already on disk, and the profile depends on that code by path,
not by version. So "is there a newer Pixel Art?" is answered by remembering to `git fetch` in four
directories.

```
detect   git fetch --tags in the bundle's own clone
read     the CHANGELOG section between the installed tag and the new one
apply    check the tree is clean, check out the tag, let DSH recompose or say restart
revert   put the previous tag and the profile files back
```

**Status: design.** There is no code here yet. `DESIGN.md` carries the scope, the decisions and the
v0 cut; this file gets rewritten when there is something to install.

House rules: private by default, MIT when it ships, `npm run check` is the gate, `node:*` before a
dependency, no telemetry, writes stay inside the workspace.
