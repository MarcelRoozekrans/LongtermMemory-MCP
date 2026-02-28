import initSqlJs, { type Database as SqlJsDatabase } from "sql.js";
import { randomUUID, createHash } from "crypto";
import path from "path";
import fs from "fs";
import { LocalEmbeddings, cosineSimilarity } from "./embeddings.js";
import { DecayEngine } from "./decay.js";
import type { Embedder, Memory, MemoryRow, MemoryStoreConfig, SearchResult } from "./types.js";

/**
 * SQLite-backed memory store with local vector search.
 * Uses sql.js (WASM) — zero native dependencies, all data stays on disk.
 */
export class MemoryStore {
  private db!: SqlJsDatabase;
  private dbPath: string;
  private embeddings: Embedder;
  private decay = new DecayEngine();
  private initialized = false;

  constructor(config?: Partial<MemoryStoreConfig>, embedder?: Embedder) {
    this.dbPath = config?.dbPath ?? path.join(process.cwd(), "data", "memories.db");
    this.embeddings = embedder ?? new LocalEmbeddings();
  }

  private contentHash(content: string): string {
    return createHash("sha256").update(content).digest("hex");
  }

  /**
   * Initialize the database. Must be called before any operations.
   */
  async init(): Promise<void> {
    if (this.initialized) return;

    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const SQL = await initSqlJs();

    // Load existing database or create new one
    if (fs.existsSync(this.dbPath)) {
      const buffer = fs.readFileSync(this.dbPath);
      this.db = new SQL.Database(buffer);
    } else {
      this.db = new SQL.Database();
    }

    this.initializeSchema();
    this.initialized = true;
  }

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

  /** Persist the in-memory database to disk. */
  private persist(): void {
    const data = this.db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(this.dbPath, buffer);
  }

  /**
   * Save a new memory with auto-generated embedding.
   */
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

  /**
   * Retrieve all memories, ordered by most recent first.
   */
  getAll(limit = 100, offset = 0): Memory[] {
    const stmt = this.db.prepare(
      `SELECT id, content, content_hash, metadata, embedding, tags, importance, memory_type, created_at, updated_at, last_accessed FROM memories ORDER BY created_at DESC LIMIT ? OFFSET ?`
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

  /**
   * Search memories using semantic similarity.
   * Generates an embedding for the query and ranks all memories by cosine similarity.
   */
  async search(query: string, limit = 5, threshold = 0.3): Promise<SearchResult[]> {
    const queryEmbedding = await this.embeddings.embed(query);

    const stmt = this.db.prepare(
      `SELECT id, content, content_hash, metadata, embedding, tags, importance, memory_type, created_at, updated_at, last_accessed FROM memories`
    );

    const candidates: { memory: Memory; score: number }[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject() as unknown as MemoryRow;
      const memory = this.rowToMemory(row);
      const score = cosineSimilarity(queryEmbedding, memory.embedding);
      if (score >= threshold) {
        candidates.push({ memory, score });
      }
    }
    stmt.free();

    const scored: SearchResult[] = candidates.map(({ memory, score }) => {
      const updated = this.applyDecayAndReinforcement(memory);
      return { memory: updated, score };
    });

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  /**
   * Get a single memory by ID.
   */
  getById(id: string): Memory | null {
    const stmt = this.db.prepare(
      `SELECT id, content, content_hash, metadata, embedding, tags, importance, memory_type, created_at, updated_at, last_accessed FROM memories WHERE id = ?`
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

  /**
   * Update a memory's content and re-generate its embedding.
   */
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

  /**
   * Delete a memory by ID.
   */
  delete(id: string): boolean {
    const before = this.count();
    this.db.run(`DELETE FROM memories WHERE id = ?`, [id]);
    const after = this.count();
    if (before !== after) {
      this.persist();
      return true;
    }
    return false;
  }

  /**
   * Delete all memories.
   */
  deleteAll(): number {
    const before = this.count();
    this.db.run(`DELETE FROM memories`);
    this.persist();
    return before;
  }

  /**
   * Get total memory count.
   */
  count(): number {
    const stmt = this.db.prepare(`SELECT COUNT(*) as count FROM memories`);
    stmt.step();
    const result = stmt.getAsObject() as { count: number };
    stmt.free();
    return result.count;
  }

  /**
   * Close the database connection.
   */
  close(): void {
    this.persist();
    this.db.close();
  }

  private applyDecayAndReinforcement(memory: Memory): Memory {
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
}
