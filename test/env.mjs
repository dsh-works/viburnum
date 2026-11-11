/**
 * Fixed git environment for the test process.
 *
 * Production code (`lib/git.js`, and the CLI child process it spawns) inherits
 * `process.env`, so a test that exercises a commit through the plugin must not
 * depend on the machine's git configuration: a CI runner has no `user.name` or
 * `user.email`, and the same suite must pass there. `test/fixtures.mjs` merges
 * this same identity into the environment it hands its own git runs.
 */

/** Variables pinned for every git process the tests start, directly or via the CLI. */
export const GIT_TEST_IDENTITY = {
  GIT_AUTHOR_NAME: 'viburnum Test',
  GIT_AUTHOR_EMAIL: 'viburnum@example.invalid',
  GIT_COMMITTER_NAME: 'viburnum Test',
  GIT_COMMITTER_EMAIL: 'viburnum@example.invalid',
  GIT_CONFIG_NOSYSTEM: '1',
}

for (const [key, value] of Object.entries(GIT_TEST_IDENTITY)) {
  if (process.env[key] === undefined || process.env[key] === '') process.env[key] = value
}
