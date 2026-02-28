# LongtermMemory-MCP

A fully local MCP server that gives AI agents persistent, semantic long-term memory — **without any cloud dependencies**.

Inspired by [mcp-mem0](https://github.com/coleam00/mcp-mem0), but runs 100% on your machine:

| Feature | mcp-mem0 | This project |
|---|---|---|
| Storage | PostgreSQL / Supabase | **SQLite** (via sql.js WASM) |
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

## Database Location

By default, memories are stored in a **shared, user-scoped location**:

```
~/.longterm-memory-mcp/memories.db
```

This means every project and every MCP client shares the same memory pool — you save a memory in one project and it's available everywhere.

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

## Backups

Backups are managed automatically and can also be triggered manually via the `create_backup` tool.

- **Auto-backup**: Triggers every 24 hours or when the memory count reaches a multiple of 100.
- **Retention**: The last 10 backups are kept; older ones are pruned automatically.
- **Format**: Each backup is a timestamped directory containing the SQLite database and a JSON export of all memories.
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
4. **Persist**: The SQLite database is a single file on disk. No background processes, no servers to maintain.

The embedding model (~30MB quantized) is downloaded once on first use and cached locally.

## Architecture

```
src/                           — MCP server source
  index.ts                     — Entry point (stdio transport, DB/backup path resolution)
  server.ts                    — MCP server factory + 11 tool definitions
  memory-store.ts              — SQLite storage + vector search + decay integration
  embeddings.ts                — Local embedding engine (Xenova/transformers)
  decay.ts                     — DecayEngine (lazy decay, reinforcement, protected tags)
  backup.ts                    — BackupManager (auto-backup, JSON export, pruning)
  types.ts                     — TypeScript interfaces (Memory, Embedder, config types)

skills/                        — Claude Code plugin skill
  long-term-memory/SKILL.md    — Teaches Claude how to use memory effectively

.claude-plugin/                — Plugin & marketplace metadata
  plugin.json                  — Plugin manifest
  marketplace.json             — Marketplace manifest
.mcp.json                      — Auto-configures MCP server on plugin install
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
npm test             # Run all 96 tests
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

## License

MIT
