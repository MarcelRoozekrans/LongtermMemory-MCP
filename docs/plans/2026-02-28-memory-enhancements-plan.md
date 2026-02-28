# Memory Enhancements Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add content deduplication, structured search (type/tags/date), memory decay & reinforcement, and auto-backups with JSON export.

**Architecture:** Extend the existing SQLite + sql.js stack. New `decay.ts` and `backup.ts` modules. Schema rewrite (no migration). All new `save_memory` fields are optional for backward compatibility.

**Tech Stack:** TypeScript, sql.js (WASM SQLite), Vitest, Zod, @modelcontextprotocol/sdk

---

### Task 1: Update Types

**Files:**
- Modify: `src/types.ts`

**Step 1: Replace `src/types.ts` with extended interfaces**

```typescript
export interface Memory {
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

export interface MemoryRow {
  id: string;
  content: string;
  content_hash: string;
  metadata: string;
  embedding: string;
  tags: string;
  importance: number;
  memory_type: string;
  created_at: string;
  updated_at: string;
  last_accessed: string;
}

export interface SearchResult {
  memory: Memory;
  score: number;
}

export interface MemoryStoreConfig {
  dbPath: string;
  backupPath?: string;
}

export interface EmbeddingConfig {
  model: string;
  cacheDir?: string;
}

/** Minimal interface for embedding providers — enables dependency injection for testing. */
export interface Embedder {
  embed(text: string): Promise<number[]>;
}

/** Valid memory types. */
export const MEMORY_TYPES = ["general", "fact", "preference", "conversation", "task", "ephemeral"] as const;
export type MemoryType = (typeof MEMORY_TYPES)[number];
```

**Step 2: Run build to verify types compile**

Run: `npm run build`
Expected: SUCCESS (existing code will fail — that's expected, we fix it in Task 2)

**Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat: extend Memory types with tags, importance, memoryType, decay fields"
```

---

### Task 2: Update MemoryStore Schema and Core Methods

**Files:**
- Modify: `src/memory-store.ts`
- Modify: `tests/unit/memory-store.test.ts`

**Step 1: Write failing tests for new save fields and dedup**

Add these tests to `tests/unit/memory-store.test.ts` inside the `save()` describe block:

```typescript
it("saves with tags, importance, and memoryType", async () => {
  const memory = await store.save("tagged note", {}, ["personal", "preference"], 8, "preference");
  expect(memory.tags).toEqual(["personal", "preference"]);
  expect(memory.importance).toBe(8);
  expect(memory.memoryType).toBe("preference");
  expect(memory.contentHash).toBeTruthy();
  expect(memory.lastAccessed).toBeTruthy();
});

it("defaults tags to [], importance to 5, memoryType to general", async () => {
  const memory = await store.save("simple note");
  expect(memory.tags).toEqual([]);
  expect(memory.importance).toBe(5);
  expect(memory.memoryType).toBe("general");
});

it("clamps importance to 1-10 range", async () => {
  const low = await store.save("low", {}, [], 0);
  expect(low.importance).toBe(1);
  const high = await store.save("high", {}, [], 15);
  expect(high.importance).toBe(10);
});

it("rejects duplicate content", async () => {
  await store.save("unique content");
  await expect(store.save("unique content")).rejects.toThrow("Duplicate");
});
```

**Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `save()` doesn't accept new parameters yet

**Step 3: Update `initializeSchema()` in `src/memory-store.ts`**

Replace the `initializeSchema` method:

```typescript
private initializeSchema(): void {
  this.db.run(`
    CREATE TABLE IF NOT EXISTS memories (
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
    )
  `);
  this.db.run(`CREATE INDEX IF NOT EXISTS idx_memories_created_at ON memories(created_at)`);
  this.db.run(`CREATE INDEX IF NOT EXISTS idx_memories_content_hash ON memories(content_hash)`);
  this.db.run(`CREATE INDEX IF NOT EXISTS idx_memories_memory_type ON memories(memory_type)`);
  this.db.run(`CREATE INDEX IF NOT EXISTS idx_memories_importance ON memories(importance)`);
  this.db.run(`CREATE INDEX IF NOT EXISTS idx_memories_last_accessed ON memories(last_accessed)`);
}
```

**Step 4: Add `contentHash()` helper to `MemoryStore`**

Add this import at the top of `memory-store.ts`:

```typescript
import { createHash } from "crypto";
```

Add this private method to the class:

```typescript
private contentHash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}
```

**Step 5: Update `save()` method signature and implementation**

Replace the existing `save()` method:

```typescript
async save(
  content: string,
  metadata: Record<string, unknown> = {},
  tags: string[] = [],
  importance: number = 5,
  memoryType: string = "general",
): Promise<Memory> {
  const clampedImportance = Math.max(1, Math.min(10, importance));
  const hash = this.contentHash(content);

  // Dedup check
  const dupStmt = this.db.prepare(`SELECT id FROM memories WHERE content_hash = ?`);
  dupStmt.bind([hash]);
  if (dupStmt.step()) {
    const existingId = (dupStmt.getAsObject() as { id: string }).id;
    dupStmt.free();
    throw new Error(`Duplicate content detected (existing memory: ${existingId})`);
  }
  dupStmt.free();

  const id = randomUUID();
  const embedding = await this.embeddings.embed(content);
  const now = new Date().toISOString();

  this.db.run(
    `INSERT INTO memories (id, content, content_hash, metadata, embedding, tags, importance, memory_type, created_at, updated_at, last_accessed)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, content, hash, JSON.stringify(metadata), JSON.stringify(embedding), JSON.stringify(tags), clampedImportance, memoryType, now, now, now]
  );
  this.persist();

  return { id, content, contentHash: hash, metadata, embedding, tags, importance: clampedImportance, memoryType, createdAt: now, updatedAt: now, lastAccessed: now };
}
```

**Step 6: Update `rowToMemory()` for new fields**

```typescript
private rowToMemory(row: MemoryRow): Memory {
  return {
    id: row.id,
    content: row.content,
    contentHash: row.content_hash,
    metadata: JSON.parse(row.metadata),
    embedding: JSON.parse(row.embedding),
    tags: JSON.parse(row.tags),
    importance: row.importance,
    memoryType: row.memory_type,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastAccessed: row.last_accessed,
  };
}
```

**Step 7: Update `getAll()` query to include new columns**

```typescript
getAll(limit = 100, offset = 0): Memory[] {
  const stmt = this.db.prepare(
    `SELECT id, content, content_hash, metadata, embedding, tags, importance, memory_type, created_at, updated_at, last_accessed
     FROM memories ORDER BY created_at DESC LIMIT ? OFFSET ?`
  );
  stmt.bind([limit, offset]);

  const rows: MemoryRow[] = [];
  while (stmt.step()) {
    const row = stmt.getAsObject() as unknown as MemoryRow;
    rows.push(row);
  }
  stmt.free();

  return rows.map(this.rowToMemory);
}
```

**Step 8: Update `search()` query to include new columns**

Update the SQL query inside `search()`:

```typescript
const stmt = this.db.prepare(
  `SELECT id, content, content_hash, metadata, embedding, tags, importance, memory_type, created_at, updated_at, last_accessed FROM memories`
);
```

**Step 9: Update `getById()` query to include new columns**

```typescript
getById(id: string): Memory | null {
  const stmt = this.db.prepare(
    `SELECT id, content, content_hash, metadata, embedding, tags, importance, memory_type, created_at, updated_at, last_accessed
     FROM memories WHERE id = ?`
  );
  stmt.bind([id]);

  if (stmt.step()) {
    const row = stmt.getAsObject() as unknown as MemoryRow;
    stmt.free();
    return this.rowToMemory(row);
  }
  stmt.free();
  return null;
}
```

**Step 10: Update `update()` method for new fields + content dedup**

Replace the existing `update()` method:

```typescript
async update(
  id: string,
  content?: string,
  metadata?: Record<string, unknown>,
  tags?: string[],
  importance?: number,
  memoryType?: string,
): Promise<Memory | null> {
  const existing = this.getById(id);
  if (!existing) return null;

  const newContent = content ?? existing.content;
  const newMetadata = metadata ?? existing.metadata;
  const newTags = tags ?? existing.tags;
  const newImportance = importance != null ? Math.max(1, Math.min(10, importance)) : existing.importance;
  const newMemoryType = memoryType ?? existing.memoryType;
  const now = new Date().toISOString();

  let newHash = existing.contentHash;
  let newEmbedding = existing.embedding;

  if (content != null && content !== existing.content) {
    newHash = this.contentHash(content);

    // Dedup check against other memories
    const dupStmt = this.db.prepare(`SELECT id FROM memories WHERE content_hash = ? AND id != ?`);
    dupStmt.bind([newHash, id]);
    if (dupStmt.step()) {
      const existingId = (dupStmt.getAsObject() as { id: string }).id;
      dupStmt.free();
      throw new Error(`Duplicate content detected (existing memory: ${existingId})`);
    }
    dupStmt.free();

    newEmbedding = await this.embeddings.embed(content);
  }

  this.db.run(
    `UPDATE memories SET content = ?, content_hash = ?, metadata = ?, embedding = ?, tags = ?, importance = ?, memory_type = ?, updated_at = ?, last_accessed = ?
     WHERE id = ?`,
    [newContent, newHash, JSON.stringify(newMetadata), JSON.stringify(newEmbedding), JSON.stringify(newTags), newImportance, newMemoryType, now, now, id]
  );
  this.persist();

  return {
    id, content: newContent, contentHash: newHash, metadata: newMetadata, embedding: newEmbedding,
    tags: newTags, importance: newImportance, memoryType: newMemoryType,
    createdAt: existing.createdAt, updatedAt: now, lastAccessed: now,
  };
}
```

**Step 11: Update existing tests that check Memory shape**

In `tests/unit/memory-store.test.ts`, update `update()` tests that call `store.update(id, "new text")` to use the new signature where `content` is the second positional arg (still works). Update assertions that check `memory.metadata` to also verify new default fields exist. Specifically:

- The `update()` describe block: calls like `store.update(saved.id, "modified")` still work since `content` is the first optional param.
- Update the test "updates content and re-embeds" to also assert `updated!.contentHash` is truthy.
- Update "preserves metadata when not provided" — call is `store.update(saved.id, "new text")` which still works.
- Update "replaces metadata when provided" — change `store.update(saved.id, "new", { key: "new" })` which still works.

**Step 12: Run tests to verify they pass**

Run: `npm test`
Expected: ALL PASS

**Step 13: Commit**

```bash
git add src/memory-store.ts src/types.ts tests/unit/memory-store.test.ts
git commit -m "feat: add schema with tags, importance, memoryType, contentHash, dedup"
```

---

### Task 3: Decay Engine

**Files:**
- Create: `src/decay.ts`
- Create: `tests/unit/decay.test.ts`

**Step 1: Write failing tests for decay calculations**

Create `tests/unit/decay.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { DecayEngine, DECAY_CONFIG } from "../../src/decay.js";

describe("DecayEngine", () => {
  const engine = new DecayEngine();

  describe("computeDecay()", () => {
    it("returns same importance when no time has passed", () => {
      const result = engine.computeDecay(5.0, 0, "general");
      expect(result).toBe(5.0);
    });

    it("halves importance after one half-life", () => {
      // general half-life = 60 days
      const result = engine.computeDecay(10.0, 60, "general");
      expect(result).toBeCloseTo(5.0, 1);
    });

    it("never drops below floor for type", () => {
      // fact floor = 3
      const result = engine.computeDecay(5.0, 9999, "fact");
      expect(result).toBe(3);
    });

    it("uses type-specific half-life", () => {
      // ephemeral half-life = 10 days → after 10 days, halved
      const result = engine.computeDecay(8.0, 10, "ephemeral");
      expect(result).toBeCloseTo(4.0, 1);
    });

    it("rounds to nearest 0.5", () => {
      const result = engine.computeDecay(7.0, 30, "general");
      // 7 * 0.5^(30/60) = 7 * 0.707 ≈ 4.95 → rounds to 5.0
      expect(result % 0.5).toBe(0);
    });
  });

  describe("shouldProtect()", () => {
    it("protects tags containing core", () => {
      expect(engine.shouldProtect(["core", "other"])).toBe(true);
    });

    it("protects tags containing identity", () => {
      expect(engine.shouldProtect(["identity"])).toBe(true);
    });

    it("protects tags containing pinned", () => {
      expect(engine.shouldProtect(["pinned"])).toBe(true);
    });

    it("does not protect regular tags", () => {
      expect(engine.shouldProtect(["personal", "work"])).toBe(false);
    });

    it("does not protect empty tags", () => {
      expect(engine.shouldProtect([])).toBe(false);
    });
  });

  describe("shouldWriteDecay()", () => {
    it("returns true when change >= 0.5", () => {
      expect(engine.shouldWriteDecay(5.0, 4.5)).toBe(true);
    });

    it("returns false when change < 0.5", () => {
      expect(engine.shouldWriteDecay(5.0, 4.8)).toBe(false);
    });
  });

  describe("computeReinforcement()", () => {
    it("accumulates 0.1 per access", () => {
      const result = engine.computeReinforcement(5.0, 0.0);
      expect(result.newAccum).toBeCloseTo(0.1);
      expect(result.shouldWrite).toBe(false);
    });

    it("triggers write when accum reaches 0.5", () => {
      const result = engine.computeReinforcement(5.0, 0.4);
      expect(result.shouldWrite).toBe(true);
      expect(result.newImportance).toBeCloseTo(5.5);
      expect(result.newAccum).toBe(0);
    });

    it("caps importance at 10", () => {
      const result = engine.computeReinforcement(9.8, 0.4);
      expect(result.newImportance).toBeLessThanOrEqual(10);
    });
  });

  describe("config", () => {
    it("has half-life for all memory types", () => {
      expect(DECAY_CONFIG.halfLifeDays.general).toBe(60);
      expect(DECAY_CONFIG.halfLifeDays.conversation).toBe(45);
      expect(DECAY_CONFIG.halfLifeDays.fact).toBe(120);
      expect(DECAY_CONFIG.halfLifeDays.preference).toBe(90);
      expect(DECAY_CONFIG.halfLifeDays.task).toBe(30);
      expect(DECAY_CONFIG.halfLifeDays.ephemeral).toBe(10);
    });

    it("has floor for all memory types", () => {
      expect(DECAY_CONFIG.floors.general).toBe(1);
      expect(DECAY_CONFIG.floors.conversation).toBe(2);
      expect(DECAY_CONFIG.floors.fact).toBe(3);
      expect(DECAY_CONFIG.floors.preference).toBe(2);
      expect(DECAY_CONFIG.floors.task).toBe(1);
      expect(DECAY_CONFIG.floors.ephemeral).toBe(1);
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `src/decay.ts` doesn't exist

**Step 3: Implement `src/decay.ts`**

```typescript
export const DECAY_CONFIG = {
  halfLifeDays: {
    general: 60,
    conversation: 45,
    fact: 120,
    preference: 90,
    task: 30,
    ephemeral: 10,
  } as Record<string, number>,
  floors: {
    general: 1,
    conversation: 2,
    fact: 3,
    preference: 2,
    task: 1,
    ephemeral: 1,
  } as Record<string, number>,
  protectedTags: new Set(["core", "identity", "pinned"]),
  writebackStep: 0.5,
  reinforcementStep: 0.1,
  reinforcementWritebackStep: 0.5,
  maxImportance: 10,
};

export class DecayEngine {
  /** Round to nearest 0.5 */
  private roundToHalf(value: number): number {
    return Math.round(value * 2) / 2;
  }

  /**
   * Compute decayed importance based on idle days and memory type.
   * Never drops below the floor for the given type.
   */
  computeDecay(importance: number, daysIdle: number, memoryType: string): number {
    const halfLife = DECAY_CONFIG.halfLifeDays[memoryType] ?? DECAY_CONFIG.halfLifeDays.general;
    const floor = DECAY_CONFIG.floors[memoryType] ?? DECAY_CONFIG.floors.general;

    if (daysIdle <= 0 || halfLife <= 0) return importance;

    const factor = Math.pow(0.5, daysIdle / halfLife);
    const decayed = this.roundToHalf(importance * factor);
    return Math.max(floor, decayed);
  }

  /** Check if any tags are in the protected set. */
  shouldProtect(tags: string[]): boolean {
    return tags.some((tag) => DECAY_CONFIG.protectedTags.has(tag));
  }

  /** Returns true if the decay delta is large enough to persist. */
  shouldWriteDecay(oldImportance: number, newImportance: number): boolean {
    return oldImportance - newImportance >= DECAY_CONFIG.writebackStep;
  }

  /**
   * Compute reinforcement for an access event.
   * Returns updated accumulator and whether to write back.
   */
  computeReinforcement(
    importance: number,
    currentAccum: number,
  ): { newAccum: number; shouldWrite: boolean; newImportance?: number } {
    const accum = currentAccum + DECAY_CONFIG.reinforcementStep;

    if (accum >= DECAY_CONFIG.reinforcementWritebackStep) {
      const newImportance = Math.min(
        DECAY_CONFIG.maxImportance,
        this.roundToHalf(importance + accum),
      );
      return { newAccum: 0, shouldWrite: true, newImportance };
    }

    return { newAccum: accum, shouldWrite: false };
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add src/decay.ts tests/unit/decay.test.ts
git commit -m "feat: add DecayEngine with lazy decay and reinforcement logic"
```

---

### Task 4: Integrate Decay into MemoryStore

**Files:**
- Modify: `src/memory-store.ts`
- Modify: `tests/unit/memory-store.test.ts`

**Step 1: Write failing tests for decay on access**

Add to `tests/unit/memory-store.test.ts`:

```typescript
describe("decay on access", () => {
  it("updates lastAccessed when retrieving by id", async () => {
    const saved = await store.save("decay test");
    // Manually backdate last_accessed in the DB to simulate old memory
    // We can't easily do this through the public API, so we test indirectly
    const found = store.getById(saved.id);
    expect(found!.lastAccessed).toBeTruthy();
  });

  it("updates lastAccessed on search results", async () => {
    await store.save("searchable content");
    const results = await store.search("searchable", 5, 0.0);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].memory.lastAccessed).toBeTruthy();
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL (or existing tests fail due to missing decay integration)

**Step 3: Add decay integration to `MemoryStore`**

Add import at top of `memory-store.ts`:

```typescript
import { DecayEngine } from "./decay.js";
```

Add field to the class:

```typescript
private decay = new DecayEngine();
```

Add a private method to apply decay + reinforcement on a row and return the (possibly updated) memory:

```typescript
private applyDecayAndReinforcement(memory: Memory): Memory {
  // Skip if protected
  if (this.decay.shouldProtect(memory.tags)) return memory;

  const now = new Date();
  const lastAccessed = new Date(memory.lastAccessed);
  const daysIdle = Math.max(0, (now.getTime() - lastAccessed.getTime()) / (1000 * 60 * 60 * 24));

  let currentImportance = memory.importance;

  // Decay
  const decayed = this.decay.computeDecay(currentImportance, daysIdle, memory.memoryType);
  if (this.decay.shouldWriteDecay(currentImportance, decayed)) {
    currentImportance = decayed;
    this.db.run(`UPDATE memories SET importance = ? WHERE id = ?`, [currentImportance, memory.id]);
  }

  // Reinforcement
  const currentAccum = (memory.metadata as Record<string, unknown>).reinforcement_accum as number ?? 0;
  const reinforcement = this.decay.computeReinforcement(currentImportance, currentAccum);

  const newMeta = { ...memory.metadata, reinforcement_accum: reinforcement.newAccum };
  if (reinforcement.shouldWrite && reinforcement.newImportance != null) {
    currentImportance = reinforcement.newImportance;
    this.db.run(
      `UPDATE memories SET importance = ?, metadata = ? WHERE id = ?`,
      [currentImportance, JSON.stringify(newMeta), memory.id],
    );
  } else {
    this.db.run(`UPDATE memories SET metadata = ? WHERE id = ?`, [JSON.stringify(newMeta), memory.id]);
  }

  // Update lastAccessed
  const nowIso = now.toISOString();
  this.db.run(`UPDATE memories SET last_accessed = ? WHERE id = ?`, [nowIso, memory.id]);
  this.persist();

  return { ...memory, importance: currentImportance, metadata: newMeta, lastAccessed: nowIso };
}
```

Update `getById()` to call decay:

```typescript
getById(id: string): Memory | null {
  const stmt = this.db.prepare(
    `SELECT id, content, content_hash, metadata, embedding, tags, importance, memory_type, created_at, updated_at, last_accessed
     FROM memories WHERE id = ?`
  );
  stmt.bind([id]);

  if (stmt.step()) {
    const row = stmt.getAsObject() as unknown as MemoryRow;
    stmt.free();
    const memory = this.rowToMemory(row);
    return this.applyDecayAndReinforcement(memory);
  }
  stmt.free();
  return null;
}
```

Update `search()` to call decay on each result:

```typescript
async search(query: string, limit = 5, threshold = 0.3): Promise<SearchResult[]> {
  const queryEmbedding = await this.embeddings.embed(query);

  const stmt = this.db.prepare(
    `SELECT id, content, content_hash, metadata, embedding, tags, importance, memory_type, created_at, updated_at, last_accessed FROM memories`
  );

  const scored: SearchResult[] = [];
  while (stmt.step()) {
    const row = stmt.getAsObject() as unknown as MemoryRow;
    const memory = this.rowToMemory(row);
    const score = cosineSimilarity(queryEmbedding, memory.embedding);
    if (score >= threshold) {
      const updated = this.applyDecayAndReinforcement(memory);
      scored.push({ memory: updated, score });
    }
  }
  stmt.free();

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
```

**Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add src/memory-store.ts tests/unit/memory-store.test.ts
git commit -m "feat: integrate lazy decay and reinforcement into MemoryStore"
```

---

### Task 5: Structured Search Methods

**Files:**
- Modify: `src/memory-store.ts`
- Modify: `tests/unit/memory-store.test.ts`

**Step 1: Write failing tests for structured searches**

Add to `tests/unit/memory-store.test.ts`:

```typescript
// ── searchByType ──────────────────────────────────────────
describe("searchByType()", () => {
  it("returns empty array when no matches", async () => {
    await store.save("note", {}, [], 5, "general");
    expect(store.searchByType("fact")).toEqual([]);
  });

  it("returns memories of specified type", async () => {
    await store.save("a fact", {}, [], 5, "fact");
    await store.save("a pref", {}, [], 5, "preference");
    await store.save("another fact", {}, [], 5, "fact");

    const results = store.searchByType("fact");
    expect(results).toHaveLength(2);
    expect(results.every((m) => m.memoryType === "fact")).toBe(true);
  });

  it("orders by importance DESC then created_at DESC", async () => {
    await store.save("low", {}, [], 3, "fact");
    await store.save("high", {}, [], 9, "fact");

    const results = store.searchByType("fact");
    expect(results[0].content).toBe("high");
    expect(results[1].content).toBe("low");
  });

  it("respects limit", async () => {
    await store.save("a", {}, [], 5, "fact");
    await store.save("b", {}, [], 5, "fact");
    await store.save("c", {}, [], 5, "fact");
    expect(store.searchByType("fact", 2)).toHaveLength(2);
  });
});

// ── searchByTags ──────────────────────────────────────────
describe("searchByTags()", () => {
  it("returns empty array when no matches", async () => {
    await store.save("note", {}, ["work"]);
    expect(store.searchByTags(["personal"])).toEqual([]);
  });

  it("matches any of the provided tags", async () => {
    await store.save("a", {}, ["personal", "hobby"]);
    await store.save("b", {}, ["work"]);
    await store.save("c", {}, ["personal"]);

    const results = store.searchByTags(["personal"]);
    expect(results).toHaveLength(2);
  });

  it("respects limit", async () => {
    await store.save("a", {}, ["x"]);
    await store.save("b", {}, ["x"]);
    await store.save("c", {}, ["x"]);
    expect(store.searchByTags(["x"], 2)).toHaveLength(2);
  });
});

// ── searchByDateRange ─────────────────────────────────────
describe("searchByDateRange()", () => {
  it("returns empty array when no matches in range", async () => {
    await store.save("old note");
    const results = store.searchByDateRange("2099-01-01", "2099-12-31");
    expect(results).toEqual([]);
  });

  it("returns memories within date range", async () => {
    await store.save("recent note");
    const now = new Date();
    const from = new Date(now.getTime() - 60000).toISOString(); // 1 min ago
    const to = new Date(now.getTime() + 60000).toISOString();   // 1 min from now
    const results = store.searchByDateRange(from, to);
    expect(results).toHaveLength(1);
  });

  it("respects limit", async () => {
    await store.save("a");
    await store.save("b");
    await store.save("c");
    const from = new Date(Date.now() - 60000).toISOString();
    const to = new Date(Date.now() + 60000).toISOString();
    expect(store.searchByDateRange(from, to, 2)).toHaveLength(2);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — methods don't exist

**Step 3: Implement structured search methods in `MemoryStore`**

Add these methods to the `MemoryStore` class:

```typescript
searchByType(memoryType: string, limit = 20): Memory[] {
  const stmt = this.db.prepare(
    `SELECT id, content, content_hash, metadata, embedding, tags, importance, memory_type, created_at, updated_at, last_accessed
     FROM memories WHERE memory_type = ? ORDER BY importance DESC, created_at DESC LIMIT ?`
  );
  stmt.bind([memoryType, limit]);

  const results: Memory[] = [];
  while (stmt.step()) {
    const row = stmt.getAsObject() as unknown as MemoryRow;
    results.push(this.rowToMemory(row));
  }
  stmt.free();
  return results;
}

searchByTags(tags: string[], limit = 20): Memory[] {
  // Build WHERE clause matching ANY of the provided tags
  const conditions = tags.map(() => `tags LIKE ?`).join(" OR ");
  const params = tags.map((tag) => `%"${tag}"%`);

  const stmt = this.db.prepare(
    `SELECT id, content, content_hash, metadata, embedding, tags, importance, memory_type, created_at, updated_at, last_accessed
     FROM memories WHERE ${conditions} ORDER BY importance DESC, created_at DESC LIMIT ?`
  );
  stmt.bind([...params, limit]);

  const results: Memory[] = [];
  while (stmt.step()) {
    const row = stmt.getAsObject() as unknown as MemoryRow;
    results.push(this.rowToMemory(row));
  }
  stmt.free();
  return results;
}

searchByDateRange(dateFrom: string, dateTo?: string, limit = 50): Memory[] {
  const to = dateTo ?? new Date().toISOString();
  const stmt = this.db.prepare(
    `SELECT id, content, content_hash, metadata, embedding, tags, importance, memory_type, created_at, updated_at, last_accessed
     FROM memories WHERE created_at BETWEEN ? AND ? ORDER BY created_at DESC LIMIT ?`
  );
  stmt.bind([dateFrom, to, limit]);

  const results: Memory[] = [];
  while (stmt.step()) {
    const row = stmt.getAsObject() as unknown as MemoryRow;
    results.push(this.rowToMemory(row));
  }
  stmt.free();
  return results;
}
```

**Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add src/memory-store.ts tests/unit/memory-store.test.ts
git commit -m "feat: add searchByType, searchByTags, searchByDateRange methods"
```

---

### Task 6: Backup Manager

**Files:**
- Create: `src/backup.ts`
- Create: `tests/unit/backup.test.ts`

**Step 1: Write failing tests for BackupManager**

Create `tests/unit/backup.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { BackupManager } from "../../src/backup.js";
import fs from "fs";
import path from "path";
import os from "os";

describe("BackupManager", () => {
  let tmpDir: string;
  let backupDir: string;
  let dbPath: string;
  let manager: BackupManager;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "backup-test-"));
    backupDir = path.join(tmpDir, "backups");
    dbPath = path.join(tmpDir, "memories.db");
    fs.writeFileSync(dbPath, "fake-db-content");
    manager = new BackupManager(dbPath, backupDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("createBackup()", () => {
    it("creates backup directory if it does not exist", () => {
      expect(fs.existsSync(backupDir)).toBe(false);
      manager.createBackup([]);
      expect(fs.existsSync(backupDir)).toBe(true);
    });

    it("copies the database file", () => {
      const result = manager.createBackup([]);
      const files = fs.readdirSync(result.backupPath);
      expect(files).toContain("memories.db");
    });

    it("exports memories as JSON", () => {
      const memories = [
        { id: "1", content: "test", tags: ["a"], importance: 5, memoryType: "fact", createdAt: "2026-01-01T00:00:00Z" },
      ];
      const result = manager.createBackup(memories);
      const files = fs.readdirSync(result.backupPath);
      expect(files).toContain("memories_export.json");

      const exported = JSON.parse(fs.readFileSync(path.join(result.backupPath, "memories_export.json"), "utf-8"));
      expect(exported.total_memories).toBe(1);
      expect(exported.memories).toHaveLength(1);
    });

    it("returns backup metadata", () => {
      const result = manager.createBackup([]);
      expect(result.backupPath).toContain("memory_backup_");
      expect(result.memoriesBackedUp).toBe(0);
      expect(result.timestamp).toBeTruthy();
    });
  });

  describe("pruneBackups()", () => {
    it("keeps only the last 10 backups", () => {
      // Create 12 backups
      for (let i = 0; i < 12; i++) {
        manager.createBackup([]);
      }
      manager.pruneBackups();
      const dirs = fs.readdirSync(backupDir).filter((d) =>
        fs.statSync(path.join(backupDir, d)).isDirectory()
      );
      expect(dirs.length).toBeLessThanOrEqual(10);
    });
  });

  describe("shouldBackup()", () => {
    it("returns true when no backup has been made", () => {
      expect(manager.shouldBackup(5)).toBe(true);
    });

    it("returns false immediately after a backup", () => {
      manager.createBackup([]);
      expect(manager.shouldBackup(5)).toBe(false);
    });

    it("returns true when memory count is multiple of 100", () => {
      manager.createBackup([]);
      expect(manager.shouldBackup(100)).toBe(true);
      expect(manager.shouldBackup(200)).toBe(true);
      expect(manager.shouldBackup(99)).toBe(false);
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `src/backup.ts` doesn't exist

**Step 3: Implement `src/backup.ts`**

```typescript
import fs from "fs";
import path from "path";

export interface BackupResult {
  backupPath: string;
  memoriesBackedUp: number;
  timestamp: string;
}

export class BackupManager {
  private dbPath: string;
  private backupDir: string;
  private lastBackupTime: Date | null = null;
  private maxBackups = 10;
  private backupIntervalMs = 24 * 60 * 60 * 1000; // 24 hours

  constructor(dbPath: string, backupDir?: string) {
    this.dbPath = dbPath;
    this.backupDir = backupDir ?? path.join(path.dirname(dbPath), "backups");
  }

  createBackup(memories: Array<Record<string, unknown>>): BackupResult {
    if (!fs.existsSync(this.backupDir)) {
      fs.mkdirSync(this.backupDir, { recursive: true });
    }

    const timestamp = new Date();
    const folderName = `memory_backup_${timestamp.toISOString().replace(/[:.]/g, "").replace("T", "_").slice(0, 15)}`;
    const backupPath = path.join(this.backupDir, folderName);
    fs.mkdirSync(backupPath, { recursive: true });

    // Copy database file
    if (fs.existsSync(this.dbPath)) {
      fs.copyFileSync(this.dbPath, path.join(backupPath, "memories.db"));
    }

    // Export memories as JSON
    const exportData = {
      export_timestamp: timestamp.toISOString(),
      total_memories: memories.length,
      memories,
    };
    fs.writeFileSync(
      path.join(backupPath, "memories_export.json"),
      JSON.stringify(exportData, null, 2),
      "utf-8",
    );

    this.lastBackupTime = timestamp;

    this.pruneBackups();

    return {
      backupPath,
      memoriesBackedUp: memories.length,
      timestamp: timestamp.toISOString(),
    };
  }

  pruneBackups(): void {
    if (!fs.existsSync(this.backupDir)) return;

    const dirs = fs
      .readdirSync(this.backupDir)
      .filter((d) => {
        const fullPath = path.join(this.backupDir, d);
        return fs.statSync(fullPath).isDirectory();
      })
      .sort()
      .reverse(); // newest first

    for (const old of dirs.slice(this.maxBackups)) {
      fs.rmSync(path.join(this.backupDir, old), { recursive: true, force: true });
    }
  }

  shouldBackup(memoryCount: number): boolean {
    if (memoryCount > 0 && memoryCount % 100 === 0) return true;

    if (this.lastBackupTime === null) return true;

    const elapsed = Date.now() - this.lastBackupTime.getTime();
    return elapsed >= this.backupIntervalMs;
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add src/backup.ts tests/unit/backup.test.ts
git commit -m "feat: add BackupManager with auto-backup, JSON export, and pruning"
```

---

### Task 7: Integrate Backup into MemoryStore

**Files:**
- Modify: `src/memory-store.ts`
- Modify: `src/index.ts`

**Step 1: Add BackupManager to MemoryStore**

In `src/memory-store.ts`, add import:

```typescript
import { BackupManager } from "./backup.js";
```

Add field and constructor parameter:

```typescript
private backup?: BackupManager;

constructor(config?: Partial<MemoryStoreConfig>, embedder?: Embedder, backupManager?: BackupManager) {
  this.dbPath = config?.dbPath ?? path.join(process.cwd(), "data", "memories.db");
  this.embeddings = embedder ?? new LocalEmbeddings();
  this.backup = backupManager;
}
```

Add a private helper to trigger maybe-backup after saves:

```typescript
private maybeBackup(): void {
  if (!this.backup) return;
  const memCount = this.count();
  if (this.backup.shouldBackup(memCount)) {
    const allMemories = this.getAll(10000, 0);
    const exportable = allMemories.map((m) => ({
      id: m.id, content: m.content, tags: m.tags, importance: m.importance,
      memoryType: m.memoryType, metadata: m.metadata, createdAt: m.createdAt, updatedAt: m.updatedAt,
    }));
    this.backup.createBackup(exportable);
  }
}
```

Call `this.maybeBackup()` at the end of the `save()` method, after `this.persist()`.

Add a public method to expose manual backup:

```typescript
createBackup(): { backupPath: string; memoriesBackedUp: number; timestamp: string } | null {
  if (!this.backup) return null;
  const allMemories = this.getAll(10000, 0);
  const exportable = allMemories.map((m) => ({
    id: m.id, content: m.content, tags: m.tags, importance: m.importance,
    memoryType: m.memoryType, metadata: m.metadata, createdAt: m.createdAt, updatedAt: m.updatedAt,
  }));
  return this.backup.createBackup(exportable);
}
```

**Step 2: Update `src/index.ts` to configure backup path**

```typescript
#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { MemoryStore } from "./memory-store.js";
import { BackupManager } from "./backup.js";
import { createServer } from "./server.js";
import os from "os";
import path from "path";

const DEFAULT_DB_DIR = path.join(os.homedir(), ".longterm-memory-mcp");
const DB_PATH = process.env.MEMORY_DB_PATH ?? path.join(DEFAULT_DB_DIR, "memories.db");
const BACKUP_PATH = process.env.MEMORY_BACKUP_PATH ?? path.join(path.dirname(DB_PATH), "backups");

async function main(): Promise<void> {
  const backupManager = new BackupManager(DB_PATH, BACKUP_PATH);
  const store = new MemoryStore({ dbPath: DB_PATH }, undefined, backupManager);
  await store.init();

  const server = createServer(store, DB_PATH);
  const transport = new StdioServerTransport();
  await server.connect(transport);

  process.on("SIGINT", () => {
    store.close();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    store.close();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
```

**Step 3: Run tests to verify nothing broke**

Run: `npm test`
Expected: ALL PASS (backup is optional — existing tests don't pass a BackupManager)

**Step 4: Commit**

```bash
git add src/memory-store.ts src/index.ts
git commit -m "feat: integrate BackupManager into MemoryStore and index.ts"
```

---

### Task 8: Update MCP Server Tools

**Files:**
- Modify: `src/server.ts`

**Step 1: Update `save_memory` tool with new optional fields**

Replace the `save_memory` tool registration in `server.ts`:

```typescript
server.tool(
  "save_memory",
  "Save information to long-term memory. The content will be embedded locally and indexed for semantic search. Use this to store facts, decisions, preferences, or any context worth remembering across sessions.",
  {
    content: z.string().describe("The text content to store in memory"),
    metadata: z
      .record(z.unknown())
      .optional()
      .describe("Optional key-value metadata to attach to this memory (e.g. { \"topic\": \"auth\", \"project\": \"api\" })"),
    tags: z
      .array(z.string())
      .optional()
      .describe("Optional tags for categorization (e.g. [\"personal\", \"preference\"])"),
    importance: z
      .number()
      .min(1)
      .max(10)
      .optional()
      .default(5)
      .describe("Importance level 1-10 (default: 5). Higher = more resistant to decay"),
    memory_type: z
      .enum(["general", "fact", "preference", "conversation", "task", "ephemeral"])
      .optional()
      .default("general")
      .describe("Memory category (default: general). Affects decay rate"),
  },
  async ({ content, metadata, tags, importance, memory_type }) => {
    try {
      const memory = await store.save(content, metadata ?? {}, tags ?? [], importance, memory_type);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                status: "saved",
                id: memory.id,
                preview: content.length > 120 ? content.slice(0, 120) + "..." : content,
                tags: memory.tags,
                importance: memory.importance,
                memoryType: memory.memoryType,
                createdAt: memory.createdAt,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text" as const, text: `Error saving memory: ${msg}` }],
        isError: true,
      };
    }
  }
);
```

**Step 2: Add `update_memory` tool**

```typescript
server.tool(
  "update_memory",
  "Update an existing memory. Can modify content (triggers re-embedding), metadata, tags, importance, or memory type.",
  {
    id: z.string().uuid().describe("The UUID of the memory to update"),
    content: z.string().optional().describe("New text content (triggers re-embedding)"),
    metadata: z.record(z.unknown()).optional().describe("New metadata object"),
    tags: z.array(z.string()).optional().describe("New tags array"),
    importance: z.number().min(1).max(10).optional().describe("New importance level 1-10"),
    memory_type: z
      .enum(["general", "fact", "preference", "conversation", "task", "ephemeral"])
      .optional()
      .describe("New memory category"),
  },
  async ({ id, content, metadata, tags, importance, memory_type }) => {
    try {
      const updated = await store.update(id, content, metadata, tags, importance, memory_type);
      if (!updated) {
        return {
          content: [{ type: "text" as const, text: `Memory ${id} not found.` }],
        };
      }
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                status: "updated",
                id: updated.id,
                content: updated.content.length > 120 ? updated.content.slice(0, 120) + "..." : updated.content,
                tags: updated.tags,
                importance: updated.importance,
                memoryType: updated.memoryType,
                updatedAt: updated.updatedAt,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text" as const, text: `Error updating memory: ${msg}` }],
        isError: true,
      };
    }
  }
);
```

**Step 3: Add `search_by_type` tool**

```typescript
server.tool(
  "search_by_type",
  "Search memories by category type (e.g. fact, preference, conversation). Returns memories ordered by importance.",
  {
    memory_type: z
      .enum(["general", "fact", "preference", "conversation", "task", "ephemeral"])
      .describe("The memory type to filter by"),
    limit: z
      .number()
      .int()
      .min(1)
      .max(50)
      .optional()
      .default(20)
      .describe("Maximum number of results (default: 20)"),
  },
  async ({ memory_type, limit }) => {
    try {
      const results = store.searchByType(memory_type, limit);
      if (results.length === 0) {
        return {
          content: [{ type: "text" as const, text: `No memories of type "${memory_type}" found.` }],
        };
      }
      const formatted = results.map((m) => ({
        id: m.id,
        content: m.content,
        tags: m.tags,
        importance: m.importance,
        memoryType: m.memoryType,
        createdAt: m.createdAt,
      }));
      return {
        content: [{ type: "text" as const, text: JSON.stringify(formatted, null, 2) }],
      };
    } catch (error) {
      return {
        content: [{ type: "text" as const, text: `Error searching by type: ${error}` }],
        isError: true,
      };
    }
  }
);
```

**Step 4: Add `search_by_tags` tool**

```typescript
server.tool(
  "search_by_tags",
  "Find memories that match any of the provided tags. Returns memories ordered by importance.",
  {
    tags: z
      .array(z.string())
      .describe("Tags to search for — matches memories containing ANY of these tags"),
    limit: z
      .number()
      .int()
      .min(1)
      .max(50)
      .optional()
      .default(20)
      .describe("Maximum number of results (default: 20)"),
  },
  async ({ tags, limit }) => {
    try {
      const results = store.searchByTags(tags, limit);
      if (results.length === 0) {
        return {
          content: [{ type: "text" as const, text: `No memories found with tags: ${tags.join(", ")}` }],
        };
      }
      const formatted = results.map((m) => ({
        id: m.id,
        content: m.content,
        tags: m.tags,
        importance: m.importance,
        memoryType: m.memoryType,
        createdAt: m.createdAt,
      }));
      return {
        content: [{ type: "text" as const, text: JSON.stringify(formatted, null, 2) }],
      };
    } catch (error) {
      return {
        content: [{ type: "text" as const, text: `Error searching by tags: ${error}` }],
        isError: true,
      };
    }
  }
);
```

**Step 5: Add `search_by_date_range` tool**

```typescript
server.tool(
  "search_by_date_range",
  "Find memories created within a specific date range. Use ISO date format.",
  {
    date_from: z
      .string()
      .describe("Start date in ISO format (e.g. \"2026-01-01\" or \"2026-01-01T00:00:00Z\")"),
    date_to: z
      .string()
      .optional()
      .describe("End date in ISO format (defaults to now)"),
    limit: z
      .number()
      .int()
      .min(1)
      .max(50)
      .optional()
      .default(50)
      .describe("Maximum number of results (default: 50)"),
  },
  async ({ date_from, date_to, limit }) => {
    try {
      const results = store.searchByDateRange(date_from, date_to, limit);
      if (results.length === 0) {
        return {
          content: [{ type: "text" as const, text: "No memories found in the specified date range." }],
        };
      }
      const formatted = results.map((m) => ({
        id: m.id,
        content: m.content,
        tags: m.tags,
        importance: m.importance,
        memoryType: m.memoryType,
        createdAt: m.createdAt,
      }));
      return {
        content: [{ type: "text" as const, text: JSON.stringify(formatted, null, 2) }],
      };
    } catch (error) {
      return {
        content: [{ type: "text" as const, text: `Error searching by date range: ${error}` }],
        isError: true,
      };
    }
  }
);
```

**Step 6: Add `create_backup` tool**

```typescript
server.tool(
  "create_backup",
  "Create a manual backup of the memory database and export all memories as JSON. Backups are stored alongside the database.",
  {},
  async () => {
    try {
      const result = store.createBackup();
      if (!result) {
        return {
          content: [{ type: "text" as const, text: "Backup not configured." }],
          isError: true,
        };
      }
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                status: "backed_up",
                backupPath: result.backupPath,
                memoriesBackedUp: result.memoriesBackedUp,
                timestamp: result.timestamp,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      return {
        content: [{ type: "text" as const, text: `Error creating backup: ${error}` }],
        isError: true,
      };
    }
  }
);
```

**Step 7: Run build to verify compilation**

Run: `npm run build`
Expected: SUCCESS

**Step 8: Commit**

```bash
git add src/server.ts
git commit -m "feat: add update_memory, search_by_type, search_by_tags, search_by_date_range, create_backup tools"
```

---

### Task 9: Update Integration Tests

**Files:**
- Modify: `tests/integration/mcp-server.test.ts`

**Step 1: Update tool listing test**

Change the expected tool count and names:

```typescript
it("exposes all 11 tools", async () => {
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name).sort();
  expect(names).toEqual([
    "create_backup",
    "delete_all_memories",
    "delete_memory",
    "get_all_memories",
    "memory_stats",
    "save_memory",
    "search_by_date_range",
    "search_by_tags",
    "search_by_type",
    "search_memory",
    "update_memory",
  ]);
});
```

**Step 2: Update existing `save_memory` tests for new response fields**

In the `save_memory` describe block, update the first test to check new response fields:

```typescript
it("saves and returns status with id and new fields", async () => {
  const result = await client.callTool({
    name: "save_memory",
    arguments: { content: "Remember this fact", tags: ["test"], importance: 7, memory_type: "fact" },
  });

  expect(result.isError).toBeFalsy();
  const parsed = JSON.parse(getText(result));
  expect(parsed.status).toBe("saved");
  expect(parsed.id).toBeTruthy();
  expect(parsed.preview).toBe("Remember this fact");
  expect(parsed.tags).toEqual(["test"]);
  expect(parsed.importance).toBe(7);
  expect(parsed.memoryType).toBe("fact");
});
```

**Step 3: Add save_memory dedup test**

```typescript
it("rejects duplicate content", async () => {
  await client.callTool({
    name: "save_memory",
    arguments: { content: "unique fact" },
  });

  const result = await client.callTool({
    name: "save_memory",
    arguments: { content: "unique fact" },
  });

  expect(result.isError).toBe(true);
  expect(getText(result)).toContain("Duplicate");
});
```

**Step 4: Add integration tests for new tools**

```typescript
// ── update_memory ──────────────────────────────────────────
describe("update_memory", () => {
  it("updates an existing memory", async () => {
    const saveResult = await client.callTool({
      name: "save_memory",
      arguments: { content: "original", tags: ["old"] },
    });
    const id = JSON.parse(getText(saveResult)).id;

    const updateResult = await client.callTool({
      name: "update_memory",
      arguments: { id, content: "modified", tags: ["new"], importance: 8 },
    });

    expect(updateResult.isError).toBeFalsy();
    const parsed = JSON.parse(getText(updateResult));
    expect(parsed.status).toBe("updated");
    expect(parsed.tags).toEqual(["new"]);
    expect(parsed.importance).toBe(8);
  });

  it("reports not found for non-existent id", async () => {
    const result = await client.callTool({
      name: "update_memory",
      arguments: { id: "00000000-0000-0000-0000-000000000000", content: "new" },
    });
    expect(getText(result)).toContain("not found");
  });
});

// ── search_by_type ─────────────────────────────────────────
describe("search_by_type", () => {
  it("returns memories of specified type", async () => {
    await client.callTool({
      name: "save_memory",
      arguments: { content: "a fact", memory_type: "fact" },
    });
    await client.callTool({
      name: "save_memory",
      arguments: { content: "a preference", memory_type: "preference" },
    });

    const result = await client.callTool({
      name: "search_by_type",
      arguments: { memory_type: "fact" },
    });

    const parsed = JSON.parse(getText(result));
    expect(parsed).toHaveLength(1);
    expect(parsed[0].memoryType).toBe("fact");
  });

  it("returns no-results message when empty", async () => {
    const result = await client.callTool({
      name: "search_by_type",
      arguments: { memory_type: "ephemeral" },
    });
    expect(getText(result)).toContain("No memories of type");
  });
});

// ── search_by_tags ─────────────────────────────────────────
describe("search_by_tags", () => {
  it("finds memories with matching tags", async () => {
    await client.callTool({
      name: "save_memory",
      arguments: { content: "tagged note", tags: ["project-x", "backend"] },
    });

    const result = await client.callTool({
      name: "search_by_tags",
      arguments: { tags: ["project-x"] },
    });

    const parsed = JSON.parse(getText(result));
    expect(parsed).toHaveLength(1);
    expect(parsed[0].content).toBe("tagged note");
  });
});

// ── search_by_date_range ───────────────────────────────────
describe("search_by_date_range", () => {
  it("finds memories within range", async () => {
    await client.callTool({
      name: "save_memory",
      arguments: { content: "recent" },
    });

    const from = new Date(Date.now() - 60000).toISOString();
    const to = new Date(Date.now() + 60000).toISOString();

    const result = await client.callTool({
      name: "search_by_date_range",
      arguments: { date_from: from, date_to: to },
    });

    const parsed = JSON.parse(getText(result));
    expect(parsed).toHaveLength(1);
  });

  it("returns no-results message for empty range", async () => {
    const result = await client.callTool({
      name: "search_by_date_range",
      arguments: { date_from: "2099-01-01", date_to: "2099-12-31" },
    });
    expect(getText(result)).toContain("No memories found");
  });
});

// ── create_backup ──────────────────────────────────────────
describe("create_backup", () => {
  it("reports backup not configured (no BackupManager in test)", async () => {
    const result = await client.callTool({
      name: "create_backup",
      arguments: {},
    });
    expect(getText(result)).toContain("not configured");
  });
});
```

**Step 5: Run all tests**

Run: `npm test`
Expected: ALL PASS

**Step 6: Commit**

```bash
git add tests/integration/mcp-server.test.ts
git commit -m "test: update integration tests for 11 tools"
```

---

### Task 10: Update search_memory Response to Include New Fields

**Files:**
- Modify: `src/server.ts`

**Step 1: Update formatted results in search_memory tool**

In the `search_memory` tool handler, update the `formatted` mapping to include new fields:

```typescript
const formatted = results.map((r, i) => ({
  rank: i + 1,
  score: Math.round(r.score * 1000) / 1000,
  id: r.memory.id,
  content: r.memory.content,
  metadata: r.memory.metadata,
  tags: r.memory.tags,
  importance: r.memory.importance,
  memoryType: r.memory.memoryType,
  createdAt: r.memory.createdAt,
}));
```

**Step 2: Update get_all_memories formatted results**

```typescript
const formatted = memories.map((m) => ({
  id: m.id,
  content: m.content,
  metadata: m.metadata,
  tags: m.tags,
  importance: m.importance,
  memoryType: m.memoryType,
  createdAt: m.createdAt,
  updatedAt: m.updatedAt,
}));
```

**Step 3: Run tests**

Run: `npm test`
Expected: ALL PASS

**Step 4: Commit**

```bash
git add src/server.ts
git commit -m "feat: include tags, importance, memoryType in search and listing results"
```

---

### Task 11: Final Verification

**Step 1: Run full test suite**

Run: `npm test`
Expected: ALL PASS

**Step 2: Run build**

Run: `npm run build`
Expected: SUCCESS

**Step 3: Verify tool count**

Run: `npm test -- --reporter=verbose 2>&1 | grep -i "tool"` or check that "exposes all 11 tools" test passes.

**Step 4: Final commit (if any remaining changes)**

```bash
git status
```

If clean, done. If not, stage and commit remaining changes.
