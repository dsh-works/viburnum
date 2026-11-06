/**
 * The routing sentence that keeps the model on the `vib_*` tools instead of
 * hand-editing `link:` paths or running git inside a plugin directory.
 *
 * @module viburnum/lib/prompt
 */

export const PROMPT = `## viburnum

When the user asks about their own linked DeepSeek Harness plugins — whether a checkout is current, pulling or pushing changes, switching a plugin to another branch, or keeping two machines in sync — use the \`vib_*\` tools. They read the same core as the \`vib\` command line and the viburnum page. viburnum never commits and never force-pushes.

For these tasks do not edit a profile's \`link:\` dependency and do not run \`git push\` inside a plugin directory. \`vib_status\` is a local read and safe to call; \`vib_update\`, \`vib_sync\`, \`vib_switch\` and \`vib_revert\` ask for approval before they move anything.`
