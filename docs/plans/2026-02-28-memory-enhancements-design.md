# Memory Enhancements Design

**Date:** 2026-02-28
**Status:** Approved
**Inspired by:** [Rotoslider/long-term-memory-mcp](https://github.com/Rotoslider/long-term-memory-mcp)

## Summary

Enhance the longterm-memory MCP server with four features from the Rotoslider project: content deduplication, structured search (by type/tags/date), memory decay & reinforcement, and auto-backups with JSON export. Uses a schema rewrite approach (no migration).

---

## 1. Schema (Fresh Design)

```sql
CREATE TABLE memories (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  metadata TEXT NOT NULL DEFAULT '{}',
  embedding TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]',
  importance REAL NOT NULL DEFAULT 5.0,
  memory_type TEXT NOT NULL DEFAULT 'general',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_accessed TEXT NOT NULL
);

CREATE INDEX idx_memories_created_at ON memories(created_at);
CREATE INDEX idx_memories_content_hash ON memories(content_hash);
CREATE INDEX idx_memories_memory_type ON memories(memory_type);
CREATE INDEX idx_memories_importance ON memories(importance);
CREATE INDEX idx_memories_last_accessed ON memories(last_accessed);
```

New columns: `content_hash`, `tags`, `importance`, `memory_type`, `last_accessed`.

---

## 2. Content Deduplication

- Compute `SHA-256(content)` on save.
- Check for existing row with same `content_hash` before inserting.
- If duplicate found, return error with existing memory ID.
- Exact content match only (no fuzzy dedup).

---

## 3. Extended `save_memory` Tool

```typescript
save_memory({
  content: string,           // required (existing)
  metadata?: object,         // optional (existing)
  tags?: string[],           // NEW - e.g. ["personal", "preference"]
  importance?: number,       // NEW - 1-10, defaults to 5
  memory_type?: string,      // NEW - "general"|"fact"|"preference"|"conversation"|"task"|"ephemeral"
})
```

- All new fields optional (backward compatible).
- `importance` clamped to 1-10 via Zod.
- `memory_type` validated against fixed set.
- Dedup check runs before embedding generation.

---

## 4. New Search Tools

### `search_by_type`

```typescript
search_by_type({
  memory_type: string,    // required
  limit?: number,         // 1-50, default 20
})
```

SQL: `WHERE memory_type = ?`, ordered by importance DESC, created_at DESC.

### `search_by_tags`

```typescript
search_by_tags({
  tags: string[],         // required, matches ANY provided tag
  limit?: number,         // 1-50, default 20
})
```

SQL with JSON matching against stored tags array.

### `search_by_date_range`

```typescript
search_by_date_range({
  date_from: string,      // required - ISO date
  date_to?: string,       // optional - defaults to now
  limit?: number,         // 1-50, default 50
})
```

SQL: `WHERE created_at BETWEEN ? AND ?`, ordered by created_at DESC.

All return same shape as `search_memory` results, without similarity score.

---

## 5. Memory Decay & Reinforcement

### Lazy Decay (on access)

- Compute `days_idle = now - last_accessed`.
- Apply: `new_importance = importance * 0.5^(days_idle / half_life)`.
- Half-life per type (days):
  - conversation: 45, task: 30, ephemeral: 10
  - preference: 90, fact: 120, general: 60
- Importance floors (never below):
  - conversation: 2, fact: 3, preference: 2
  - task: 1, ephemeral: 1, general: 1
- Protected tags skip decay: `"core"`, `"identity"`, `"pinned"`.
- Only write back if change >= 0.5 (avoid DB churn).

### Reinforcement (on access)

- Each retrieval accumulates +0.1 importance.
- When accumulated boost reaches 0.5, persist to DB.
- Capped at importance 10.

### Order of operations

Decay first, then reinforce, then update `last_accessed`.

---

## 6. Auto-Backups with JSON Export

### Triggers

- After every save, check if backup is due.
- Conditions: >24h since last backup OR memory count % 100 === 0.

### Location

- `MEMORY_BACKUP_PATH` env var if set.
- Falls back to `backups/` sibling to DB file.

### Contents

- SQLite DB file copy.
- JSON export: `{ export_timestamp, total_memories, memories: [...] }`.

### Retention

Keep last 10 backups, delete older ones.

### New tool: `create_backup`

```typescript
create_backup()  // no parameters
// Returns: { backup_path, memories_backed_up, timestamp }
```

---

## 7. `update_memory` Tool

```typescript
update_memory({
  id: string,              // required
  content?: string,        // re-embeds if changed
  metadata?: object,
  tags?: string[],
  importance?: number,     // 1-10
  memory_type?: string,
})
```

- At least one optional field required.
- Content change triggers re-embed + new content_hash + dedup check.
- Updates `updated_at` and `last_accessed`.

---

## 8. File Structure

### New files

- `src/backup.ts` — `BackupManager` class
- `src/decay.ts` — `DecayEngine` class (decay + reinforcement, config constants)

### Modified files

- `src/types.ts` — extended Memory interface, new config types
- `src/memory-store.ts` — new columns, dedup, decay/reinforce on access, backup trigger
- `src/server.ts` — extended save_memory, new tools (search_by_type, search_by_tags, search_by_date_range, create_backup, update_memory)
- `src/index.ts` — backup path resolution from env var

### New test files

- `tests/unit/decay.test.ts`
- `tests/unit/backup.test.ts`
- Updated existing tests for new schema and tools

### Updated types

```typescript
interface Memory {
  id: string;
  content: string;
  contentHash: string;
  metadata: Record<string, unknown>;
  embedding: number[];
  tags: string[];
  importance: number;
  memoryType: string;
  createdAt: string;
  updatedAt: string;
  lastAccessed: string;
}
```

---

## Tool Summary (after changes)

| Tool | Status |
|------|--------|
| `save_memory` | Extended (tags, importance, memory_type) |
| `search_memory` | Unchanged (semantic) |
| `search_by_type` | **New** |
| `search_by_tags` | **New** |
| `search_by_date_range` | **New** |
| `get_all_memories` | Unchanged |
| `update_memory` | **New** |
| `delete_memory` | Unchanged |
| `delete_all_memories` | Unchanged |
| `memory_stats` | Unchanged |
| `create_backup` | **New** |

Total: 11 tools (was 6).
