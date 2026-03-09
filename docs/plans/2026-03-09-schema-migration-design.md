# Schema Migration Design

**Date:** 2026-03-09
**Status:** Approved

## Problem

The MCP server crashes on startup when an existing database has an older schema. `CREATE TABLE IF NOT EXISTS` silently skips table creation for existing tables, then `CREATE INDEX` on missing columns (e.g., `content_hash`) causes a fatal error.

## Decision

Schema version check with wipe-and-recreate on mismatch. Schema changes are rare; preserving data across schema upgrades is not required.

## Design

### New table: `schema_meta`

```sql
CREATE TABLE IF NOT EXISTS schema_meta (
  schema_version INTEGER NOT NULL
);
```

Single row storing the current schema version.

### Constant: `SCHEMA_VERSION`

A private constant in `MemoryStore` set to `1`. Bump this when the schema changes.

### Flow in `initializeSchema()`

1. Check if `schema_meta` exists (query `sqlite_master`)
2. If not exists (legacy or fresh DB):
   - `DROP TABLE IF EXISTS memories`
   - Create `schema_meta` table, insert `schema_version = SCHEMA_VERSION`
   - Create `memories` table with full current schema
   - Create all indexes
3. If exists:
   - Read `schema_version`
   - If matches `SCHEMA_VERSION` -> no-op, return
   - If mismatch -> drop `memories`, recreate with current schema, update `schema_version`

### Future upgrades

Bump `SCHEMA_VERSION`. Old DBs get wiped and recreated automatically.

## Files Changed

- `src/memory-store.ts` — `initializeSchema()` method only

## Trade-offs

- **Pro:** Simple, explicit, ~30 lines of new code
- **Pro:** `schema_meta` table enables future migration strategies if needed
- **Con:** Loses all data on schema mismatch (acceptable for this project)
