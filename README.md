<p align="center">
  <img src="icon.svg" alt="LongtermMemory-MCP" width="128" height="128"/>
</p>

# LongtermMemory-MCP

[![codecov](https://codecov.io/gh/MarcelRoozekrans/LongtermMemory-MCP/graph/badge.svg)](https://codecov.io/gh/MarcelRoozekrans/LongtermMemory-MCP)
[![GitHub Sponsors](https://img.shields.io/github/sponsors/MarcelRoozekrans?style=flat&logo=githubsponsors&color=ea4aaa&label=Sponsor)](https://github.com/sponsors/MarcelRoozekrans)


A fully local MCP server that gives AI agents persistent, semantic long-term memory — **without any cloud dependencies**.

Inspired by [mcp-mem0](https://github.com/coleam00/mcp-mem0), but runs 100% on your machine:

| Feature | mcp-mem0 | This project |
|---|---|---|
| Storage | PostgreSQL / Supabase | **SQLite** (Node's built-in `node:sqlite`) |
| Embeddings | OpenAI API | **Local transformer** (all-MiniLM-L6-v2) |
| Vector search | Cloud vector DB | **In-process cosine similarity** |
| LLM dependency | OpenAI / OpenRouter / Ollama | **None** |
| Setup | Database + API keys | **`npx longterm-memory-mcp`** |

## Tools

### Core

| Tool | Description |
|---|---|
| `save_memory` | Store text with auto-generated semantic embedding, tags, importance, and type |
| `search_memory` | Find relevant memories using natural language queries (cosine similarity) |
| `update_memory` | Modify an existing memory's content, metadata, tags, importance, or type |
| `delete_memory` | Remove a specific memory by ID |
| `delete_all_memories` | Wipe all memories (irreversible) |
| `get_all_memories` | List all stored memories (paginated) |
| `memory_stats` | Get count and database location |

### Search

| Tool | Description |
|---|---|
| `search_by_type` | Filter memories by category (`general`, `fact`, `preference`, `conversation`, `task`, `ephemeral`) |
| `search_by_tags` | Find memories matching any of the provided tags |
| `search_by_date_range` | Find memories created within a specific date range (ISO format) |

### Maintenance

| Tool | Description |
|---|---|
| `create_backup` | Manually trigger a database backup with JSON export |

## Quick Start

### Claude Code Plugin (recommended)

Install via the Claude Code marketplace — this sets up both the MCP server and a companion skill that teaches Claude how to use memory effectively:

```
/plugin marketplace add MarcelRoozekrans/LongtermMemory-MCP
/plugin install longterm-memory@longterm-memory-marketplace
```

This automatically:
- Configures the MCP server (no manual JSON editing)
- Installs the `long-term-memory` skill (Claude learns to recall context at session start, save insights after tasks, and deduplicate memories)

### Use with npx (no install needed)

```bash
npx longterm-memory-mcp
```

### Or install globally

```bash
npm install -g longterm-memory-mcp
longterm-memory-mcp
```

### Or from source

```bash
git clone https://github.com/MarcelRoozekrans/LongtermMemory-MCP.git
cd LongtermMemory-MCP
npm install && npm run build
npm start
```

## Configuration

### Claude Code

If you installed via the plugin marketplace, the MCP server is already configured. For manual setup, add to your MCP settings (`~/.claude/settings.json` or project `.claude/settings.json`):

```json
{
  "mcpServers": {
    "longterm-memory": {
      "command": "npx",
      "args": ["-y", "longterm-memory-mcp"]
    }
  }
}
```

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "longterm-memory": {
      "command": "npx",
      "args": ["-y", "longterm-memory-mcp"]
    }
  }
}
```

### Agent Instructions

The repo includes agent instructions that teach AI agents how to use memory effectively (automatic recall, save patterns, deduplication):

| File | Purpose |
|---|---|
| `skills/long-term-memory/SKILL.md` | Self-contained skill — auto-loaded by Claude Code plugin, can be referenced from any MCP client |

## Database Location

By default, memories are stored in a **shared, user-scoped location**:

```
~/.longterm-memory-mcp/memories.db
```

This means every project and every MCP client shares the same memory pool — you save a memory in one project and it's available everywhere.

Several sessions can use the same database at once. Each server process reads and writes the shared file directly (SQLite in WAL mode), so a memory saved in one session is visible to every other session right away, and no session overwrites what another saved. Requires Node.js 22.13 or later.

Databases from older releases open unchanged. A database from v1.0–1.3, which has no `schema_meta` table, is migrated in place with all its memories kept; a copy named `memories.db.pre-migration-<timestamp>.bak` is written next to it first.

> **Upgrading from 1.4 or earlier:** stop every running session that uses the old version before starting one with the new version. Older releases keep the whole database in memory and rewrite the file on each save, so an old process left running would overwrite what new sessions saved.

### Per-project database

To isolate memories for a specific project, set the `MEMORY_DB_PATH` environment variable:

```json
{
  "mcpServers": {
    "longterm-memory": {
      "command": "npx",
      "args": ["-y", "longterm-memory-mcp"],
      "env": {
        "MEMORY_DB_PATH": "/path/to/project/memories.db"
      }
    }
  }
}
```

## Memory Types

Each memory has a `memory_type` that determines how it's categorized and how quickly it decays:

| Type | Description | Decay half-life |
|---|---|---|
| `general` | Default catch-all | 60 days |
| `fact` | Verified information | 120 days |
| `preference` | User/project preferences | 90 days |
| `conversation` | Conversation context | 45 days |
| `task` | Task-related notes | 30 days |
| `ephemeral` | Short-lived context | 10 days |

## Tags & Importance

- **Tags**: Categorize memories with string tags (e.g. `["auth", "backend"]`). Search with `search_by_tags`.
- **Importance** (1–10): Controls how resistant a memory is to decay. Default is 5. Higher importance decays more slowly.
- **Protected tags**: Memories tagged with `core`, `identity`, or `pinned` skip decay entirely.

## Decay & Reinforcement

Memories decay over time to keep the store relevant:

- **Decay**: Each memory type has a half-life (see table above). Importance decreases exponentially based on time since last access, with a floor that prevents full deletion.
- **Reinforcement**: Every time a memory is accessed via search, its importance increases by +0.1 (up to a max of 10). Frequently accessed memories stay important.
- **Lazy evaluation**: Decay is calculated on access, not on a timer — no background processes needed.

## Content Deduplication

Memory content is hashed (SHA-256) on save. If identical content already exists, the save is rejected with a reference to the existing memory ID. This prevents duplicate entries automatically.

## Content Guard

Memories end up in the database and in its JSON backups, so content is filtered before it is stored:

- **`<private>` spans are removed.** Text inside `<private>…</private>` is never stored, embedded or hashed. An unclosed `<private>` removes everything after it. Content that is empty once the spans are removed is rejected.
- **Secrets are rejected.** `save_memory` and `update_memory` refuse content, metadata values and tags that look like a secret. The error names the pattern that matched and never the value.

| Pattern | Matches |
|---|---|
| `private-key` | PEM / OpenSSH / PGP private key headers (certificates are allowed) |
| `github-token` | `ghp_`, `gho_`, `ghu_`, `ghs_`, `ghr_` and `github_pat_` tokens |
| `api-key` | `sk-…` style API keys |
| `aws-access-key` | `AKIA…` / `ASIA…` access key ids |
| `jwt` | JSON Web Tokens |
| `slack-token` | `xoxb-`, `xoxp-` and similar Slack tokens |
| `secret-assignment` | random-looking values after `password=`, `token:`, `secret=`, `api_key=`, `KEY=` and similar. References (`$VAR`, `${{ … }}`), placeholders (`<…>`), calls and plain words are allowed |

Configure it with environment variables:

```json
{
  "mcpServers": {
    "longterm-memory": {
      "command": "npx",
      "args": ["longterm-memory-mcp"],
      "env": {
        "MEMORY_GUARD_DISABLE": "jwt,slack-token",
        "MEMORY_GUARD_EXTRA_PATTERNS": "{\"internal-host\": \"\\\\b[a-z0-9-]+\\\\.corp\\\\.example\\\\b\"}"
      }
    }
  }
}
```

- `MEMORY_GUARD_DISABLE`: a comma-separated list of pattern names to turn off, or `all` for every built-in pattern. `<private>` spans are removed either way. An unknown name stops the server at startup.
- `MEMORY_GUARD_EXTRA_PATTERNS`: a JSON object of extra patterns to reject, as name → regular expression.

The guard applies to new saves and updates only. Memories stored before it existed are not rescanned.

## Automatic Recall

The Claude Code plugin ships a `UserPromptSubmit` hook that recalls memories without the agent having to ask. On the **first prompt of each session** it searches with the prompt text and adds the best matches to the context as a short list:

```
Long-term memories that may be relevant (longterm-memory; search_memory gives the full text):
- [2026-10-22 fact] pkill -f <pattern> also matches the agent's own shell … (id 31ece450-…)
```

- **Once per session:** the hook keeps a marker file per session id in `recall-sessions/` next to the database. Later prompts in that session cost one `node` start, about 30 ms, and no search.
- **Project:** the hook takes the project name from the session's working directory. A memory that names the project in its content, tags or metadata ranks a little higher. The name is not part of the search text: a short prompt would then match on the project name alone.
- **Cheap when it misses:** nothing is injected when no memory reaches the threshold, and the block never exceeds the token cap.
- **Content guard:** a stored memory that the guard rejects, such as one saved before the guard existed, is never injected.
- **Never blocks a prompt:** errors go to stderr and the prompt continues.
- **Pinned version:** the hook runs `npx longterm-memory-mcp@<plugin version> recall --hook`, so a cached older copy is never used.

Configure it with environment variables in your Claude Code settings (`env` in `~/.claude/settings.json`). The hook runs in Claude Code's environment, not the MCP server's, so a custom `MEMORY_DB_PATH` has to be set there too.

| Variable | Default | Meaning |
|---|---|---|
| `MEMORY_RECALL_ENABLED` | `true` | `false` turns the hook off |
| `MEMORY_RECALL_K` | `5` | at most this many memories (1–50) |
| `MEMORY_RECALL_THRESHOLD` | `0.5` | minimum cosine similarity (-1 to 1) |
| `MEMORY_RECALL_MAX_TOKENS` | `400` | cap on the injected block, estimated at 4 characters per token |
| `MEMORY_RECALL_STATE_DIR` | `<database dir>/recall-sessions` | where the once-per-session markers live; markers older than 30 days are removed |

### Recall CLI

The hook calls the `recall` subcommand, which also works on its own:

```bash
npx longterm-memory-mcp recall "how do we deploy the stack"
npx longterm-memory-mcp recall --k 3 --threshold 0.4 --project docker "deploy"
```

It prints the same list the hook injects, or `No relevant memories found.` on stderr. Options: `--k`, `--threshold`, `--max-tokens` and `--project` (default: the current directory's name, `""` for none). It does not create a database that does not exist yet. With `--hook` it reads a Claude Code `UserPromptSubmit` event from stdin and answers with `additionalContext`.

## Backups

Backups are managed automatically and can also be triggered manually via the `create_backup` tool.

- **Auto-backup**: Triggers every 24 hours or when the memory count reaches a multiple of 100.
- **Retention**: The last 10 backups are kept; older ones are pruned automatically.
- **Format**: Each backup is a timestamped directory containing a consistent snapshot of the SQLite database and a JSON export of all memories.
- **Location**: `~/.longterm-memory-mcp/backups/` by default, or set `MEMORY_BACKUP_PATH`:

```json
{
  "mcpServers": {
    "longterm-memory": {
      "command": "npx",
      "args": ["-y", "longterm-memory-mcp"],
      "env": {
        "MEMORY_BACKUP_PATH": "/path/to/backups"
      }
    }
  }
}
```

## How It Works

1. **Save**: Text is embedded locally using `all-MiniLM-L6-v2` (384-dim vectors) and stored in SQLite alongside the raw content, metadata, tags, importance, and type. Content is deduplicated via SHA-256 hash.
2. **Search**: Your query is embedded with the same model, then compared against every stored memory using cosine similarity. Results above the threshold are returned ranked by relevance. Accessed memories are reinforced automatically.
3. **Decay**: Over time, unused memories lose importance based on their type's half-life. Protected and frequently accessed memories resist decay.
4. **Persist**: Every change is written straight to the SQLite database on disk, so concurrent sessions share one consistent store. No background processes, no servers to maintain.

The embedding model (~30MB quantized) is downloaded once on first use and cached locally.

## Architecture

```
src/                           — MCP server source
  index.ts                     — Entry point (stdio server, or the `recall` subcommand)
  paths.ts                     — Database and recall-state path resolution
  cli.ts                       — `recall` subcommand, standalone and hook mode
  recall.ts                    — Recall search, project ranking, guard filter, token-capped list
  recall-session.ts            — Once-per-session markers for the recall hook
  server.ts                    — MCP server factory + 11 tool definitions
  memory-store.ts              — SQLite storage + vector search + decay integration
  embeddings.ts                — Local embedding engine (Xenova/transformers)
  decay.ts                     — DecayEngine (lazy decay, reinforcement, protected tags)
  backup.ts                    — BackupManager (auto-backup, JSON export, pruning)
  content-guard.ts             — Strips <private> spans, rejects secrets
  types.ts                     — TypeScript interfaces (Memory, Embedder, config types)

hooks/                         — Claude Code plugin hooks
  hooks.json                   — UserPromptSubmit → recall gate
  recall-gate.mjs              — Dependency-free gate: runs the recall CLI once per session

skills/                        — Claude Code plugin skill
  long-term-memory/SKILL.md    — Self-contained agent instructions + skill

.claude-plugin/                — Plugin & marketplace metadata
  plugin.json                  — Plugin manifest
  marketplace.json             — Marketplace manifest
.mcp.json                      — Auto-configures MCP server on plugin install
.vscode/mcp.json               — VS Code MCP server config
```

## Benchmarks

Run with `npm run bench`. Results from an in-memory store using mock embeddings (isolates store/SQLite performance from model latency):

### Cosine Similarity

| Operation | Throughput | Notes |
|---|---|---|
| Single computation (384-dim) | ~4.2M ops/s | Matches real embedding dimensions |
| 128 dimensions | ~8.6M ops/s | |
| 768 dimensions | ~2.4M ops/s | |
| 1536 dimensions | ~1.3M ops/s | Scales linearly with dimensions |

### Memory Store Operations

| Operation | Throughput | Notes |
|---|---|---|
| Save (single) | ~1,120 ops/s | Includes embed + SQLite insert + dedup check |
| Save 100 batch | ~18 ops/s | ~55ms per batch of 100 |
| Save 1000 batch | ~0.3 ops/s | ~3.1s per batch of 1000 |
| Update (content, re-embed) | ~155 ops/s | |
| Update (metadata only) | ~344 ops/s | 2.2x faster than content update |
| Delete | ~469 ops/s | |

### Search (semantic, at scale)

| Store Size | Operation | Notes |
|---|---|---|
| 10 memories | search (limit=5) | Full scan + cosine similarity per memory |
| 100 memories | search (limit=5) | |
| 500 memories | search (limit=5) | |
| 1000 memories | search (limit=5) | Linear scan — scales with store size |

### Decay Engine

| Operation | Throughput |
|---|---|
| Single decay computation | ~21M ops/s |
| Single reinforcement | ~25.7M ops/s |
| shouldProtect (tag check) | ~22M ops/s |

## Development

```bash
npm install          # Install dependencies
npm run build        # Compile TypeScript
npm test             # Run all tests
npm run bench        # Run benchmarks
npm run test:watch   # Watch mode
npm run test:coverage # Coverage report
```

## Contributing

This project uses [Conventional Commits](https://www.conventionalcommits.org/) and [semantic-release](https://github.com/semantic-release/semantic-release) for automated versioning.

### Commit message format

```
<type>(<optional scope>): <description>

[optional body]

[optional footer(s)]
```

| Type | Purpose | Version bump |
|---|---|---|
| `feat` | New feature | Minor (0.x.0) |
| `fix` | Bug fix | Patch (0.0.x) |
| `docs` | Documentation only | No release |
| `style` | Formatting, whitespace | No release |
| `refactor` | Code restructuring | No release |
| `test` | Adding/updating tests | No release |
| `chore` | Maintenance, deps | No release |
| `ci` | CI/CD changes | No release |

**Breaking changes**: Add `!` after the type (e.g., `feat!: remove deprecated API`) or include a `BREAKING CHANGE:` footer. This triggers a major version bump.

### Examples

```bash
git commit -m "feat: add memory tagging support"
git commit -m "fix: handle empty search query gracefully"
git commit -m "feat!: change default database location"
git commit -m "docs: update configuration examples"
```

Commit messages are validated locally via [commitlint](https://commitlint.js.org/) + [husky](https://typicode.github.io/husky/) git hooks. Non-conforming messages will be rejected.

### Releases

Releases are fully automated. When commits are pushed to `main`:

1. [semantic-release](https://github.com/semantic-release/semantic-release) analyzes commit messages
2. Determines the next version (major / minor / patch)
3. Generates release notes from commits
4. Updates `CHANGELOG.md`
5. Publishes to npm
6. Creates a GitHub Release

No manual version bumps or tags needed.

### Dependency Updates

Dependencies are managed automatically by [Renovate](https://github.com/apps/renovate). Patch and minor devDependency updates are auto-merged after CI passes. Major updates create PRs for manual review.

## License

MIT
