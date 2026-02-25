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

| Tool | Description |
|---|---|
| `save_memory` | Store text with auto-generated semantic embedding |
| `search_memory` | Find relevant memories using natural language queries |
| `get_all_memories` | List all stored memories (paginated) |
| `delete_memory` | Remove a specific memory by ID |
| `delete_all_memories` | Wipe all memories |
| `memory_stats` | Get count and database location |

## Quick Start

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

Add to your MCP settings (`~/.claude/settings.json` or project `.claude/settings.json`):

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

## How It Works

1. **Save**: Text is embedded locally using `all-MiniLM-L6-v2` (384-dim vectors) and stored in SQLite alongside the raw content and metadata.
2. **Search**: Your query is embedded with the same model, then compared against every stored memory using cosine similarity. Results above the threshold are returned ranked by relevance.
3. **Persist**: The SQLite database is a single file on disk. No background processes, no servers to maintain.

The embedding model (~30MB quantized) is downloaded once on first use and cached locally.

## Architecture

```
src/
  index.ts          — Entry point (stdio transport, DB path resolution)
  server.ts         — MCP server factory + tool definitions
  memory-store.ts   — SQLite storage + vector search logic
  embeddings.ts     — Local embedding engine (Xenova/transformers)
  types.ts          — TypeScript interfaces (Memory, Embedder, etc.)
```

## Development

```bash
npm install          # Install dependencies
npm run build        # Compile TypeScript
npm test             # Run all 46 tests
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
