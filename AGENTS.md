# AGENTS.md: LongtermMemory-MCP

A fully local MCP server for long-term agent memory with semantic search (SQLite via `node:sqlite`,
local embeddings), published to npm as `longterm-memory-mcp` and to the MCP Registry. The same repo
ships a Claude Code plugin: a skill, a `UserPromptSubmit` recall hook and a launcher for the server.

## Layout

- `src/` is the only TypeScript. `tsc` compiles it to `dist/`, which is git-ignored and is what npm
  ships, together with `skills/`, `server.json`, `README.md`, `LICENSE` and `icon.svg`.
- `hooks/`, `scripts/` and `.claude-plugin/` are plain Node ESM with no dependencies and no build
  step. The plugin runs them straight from the repo, so they must not import from `dist/` or from
  `node_modules`.
- `hooks/recall-gate.mjs` repeats the path rules of `src/paths.ts` and `src/recall-session.ts` on
  purpose, because it cannot import them. `tests/unit/recall-gate.test.ts` keeps both copies equal:
  change one, change the other.
- `.mcp.json` and `.vscode/mcp.json` run the published package, not this checkout.
- `tests/fixtures/*.db` are tracked SQLite fixtures, built by `tests/fixtures/generate-fixtures.mjs`.
  All other `*.db` files are git-ignored.

## Build and test

Needs Node 22.13 or later, for the built-in `node:sqlite` (`engines`). No `.nvmrc`; CI uses Node 22
and 24 on ubuntu and windows for the test job, and Node 26 for typecheck and publish.

CI job `Test` in `.github/workflows/ci.yml`, every matrix leg:

```bash
npm ci
npm run build
npm run test:coverage
```

CI job `Typecheck`:

```bash
npm ci
npx tsc --noEmit
```

CI job `Lint commit messages` runs on pull requests only:
`npx commitlint --from "$BASE_SHA" --to "$HEAD_SHA" --verbose`.

Inner loop, run locally and passing:

```bash
npm test                                   # vitest run, 13 files, about 4 s
npx vitest run tests/unit/decay.test.ts    # one file
npm run bench                              # vitest bench, tests/benchmarks
```

The husky `pre-commit` hook runs `npm run build && npm test`, and `commit-msg` runs commitlint.

Tests never download the embedding model: they use `tests/helpers/mock-embeddings.ts` and an
in-memory store (`dbPath: ":memory:"`). Keep new tests offline the same way.

## Conventions and gotchas

- **One version, six files.** release-please keeps these equal, so do not edit them by hand:
  `package.json`, `package-lock.json`, `.release-please-manifest.json`, `server.json` (`$.version` and
  `$.packages[0].version`), `.claude-plugin/plugin.json` (`$.version`) and
  `.claude-plugin/marketplace.json` (`$.metadata.version` and `$.plugins[0].version`). A new file
  that carries the version goes into `extra-files` in `release-please-config.json`.
- The plugin pins the server to its own version: `scripts/plugin-package.mjs` reads
  `.claude-plugin/plugin.json` and the plugin starts `npx -y longterm-memory-mcp@<version>`, and the
  recall hook does the same. A plugin version without a published npm package breaks the plugin.
- Publishing is part of `Release Please` (`release-please.yml`): npm first, then the MCP Registry,
  which waits until npm serves the version. `publish-mcp-registry.yml` is a manual re-run only.
- The server runs over stdio: in server mode stdout carries the MCP protocol, so never write to it. Log
  to stderr. Only the `recall` subcommand in `src/cli.ts` prints to stdout.
- `src/content-guard.ts` strips `<private>` spans and rejects secrets before a memory is saved. Keep
  every write path behind it.
- Several processes share one database in WAL mode (`tests/unit/concurrency.test.ts`). Do not hold
  the whole database in memory or rewrite the file on save.
- `tsconfig.json` uses `module: Node16`: relative imports in `src/` and `tests/` end in `.js`.

<!-- org-core:start sha256=08a88996bc9165f888fc0260607cfd0670cae128c323e16707c6b452ee66222d (generated from docker-nuc scripts/agents-md/org-core-personal.md; do not edit here) -->
## Org rules

These rules hold in every public MarcelRoozekrans repo.

### Commits and releases

- Conventional Commits. release-please reads them on the default branch, and the changelog sections
  in `release-please-config.json` decide which types count. The standard: `feat`, `fix`, `perf`,
  `deps` and `revert` open or update the release PR; `docs`, `test`, `refactor`, `build`, `ci`,
  `chore` and `style` do not, unless the commit is breaking or has a `Release-As:` footer. The
  release happens when that PR merges. A breaking change needs `!` or a `BREAKING CHANGE:` footer.
- A commit body never contains nested parentheses. release-please cannot parse them and silently
  drops the whole commit from the changelog, while the workflow still reports success.
- After merging a commit that should release, check that it appears in the release-please PR.

### Branches and pull requests

- Every change goes through a branch and a pull request. Never push to the default branch directly.
- A PR body says what the diff does, and nothing the diff does not do.
- Fix review findings in the PR under review, including small ones. File an issue only for a finding
  that belongs to other code, needs a design decision, is its own piece of work, or waits on
  something external.

### CI

- The .NET repos call the shared workflows of `MarcelRoozekrans/ci-baseline`, pinned to `@v1`, never
  `@main`.
- Its coverage gate fails the build when line coverage drops below the floor of 80%, and Codecov
  fails a PR that lowers project coverage by more than 1 percentage point. New code comes with
  tests.
- A repo with a lower floor documents the reason and links the issue that raises it.
<!-- org-core:end -->
