# Security

## Reporting

Do not open a public issue for a security problem. Use GitHub's **Security → Report a vulnerability**
(Security Advisories) on this repository and include:

- the affected commit or version,
- the harness version and operating system,
- a reproduction, and
- what you expected instead.

You will get an acknowledgement, a fix or a documented decision, and credit in the release notes if
you want it.

## Scope

viburnum runs in the DeepSeek Harness Host process, serves two same-origin JSON routes, and spawns
`git` with an explicit working directory, a timeout and `GIT_TERMINAL_PROMPT=0`.

In scope:

- the Host half (`index.js`, `lib/`), the browser half (`client.js`), and the `vib` CLI;
- the `/viburnum/status` and `/viburnum/action` routes;
- the profile state file at `$DSH_HOME/profiles/<profile>/.viburnum/`;
- anything that lets a page or a tool move a checkout the user did not ask to move.

Out of scope:

- git authentication and credential handling — viburnum inherits git's own behaviour;
- the DeepSeek Harness itself, and other plugins;
- an attacker who already has the user's account or local shell.

## Design notes

- The routes require the `x-viburnum: 1` header, so a cross-site form cannot post an action; the
  routes are bound to the Host's localhost listener.
- No credentials are stored or read by viburnum. The 0.2 organisation door will resolve a
  `GITHUB_TOKEN` reference through the harness credential service, never in plugin config.
- Moves never force-push and never commit; a move that would rewrite published history is refused.
- The state file contains paths, commit ids and status — not secrets.
