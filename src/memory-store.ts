import initSqlJs, { type Database as SqlJsDatabase } from "sql.js";
import { randomUUID } from "crypto";
import path from "path";
import fs from "fs";
import { LocalEmbeddings, cosineSimilarity } from "./embeddings.js";
import type { Embedder, Memory, MemoryRow, MemoryStoreConfig, SearchResult } from "./types.js";

/**
 * SQLite-backed memory store with local vector search.
 * Uses sql.js (WASM) — zero native dependencies, all data stays on disk.
 */
export class MemoryStore {
  private db!: SqlJsDatabase;
  private dbPath: string;
  private embeddings: Embedder;
  private initialized = false;

  constructor(config?: Partial<MemoryStoreConfig>, embedder?: Embedder) {
    this.dbPath = config?.dbPath ?? path.join(process.cwd(), "data", "memories.db");
    this.embeddings = embedder ?? new LocalEmbeddings();
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
        metadata TEXT NOT NULL DEFAULT '{}',
        embedding TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_memories_created_at ON memories(created_at)
    `);
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
  async save(content: string, metadata: Record<string, unknown> = {}): Promise<Memory> {
    const id = randomUUID();
    const embedding = await this.embeddings.embed(content);
    const now = new Date().toISOString();

    this.db.run(
      `INSERT INTO memories (id, content, metadata, embedding, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
      [id, content, JSON.stringify(metadata), JSON.stringify(embedding), now, now]
    );
    this.persist();

    return { id, content, metadata, embedding, createdAt: now, updatedAt: now };
  }

  /**
   * Retrieve all memories, ordered by most recent first.
   */
  getAll(limit = 100, offset = 0): Memory[] {
    const stmt = this.db.prepare(
      `SELECT id, content, metadata, embedding, created_at, updated_at FROM memories ORDER BY created_at DESC LIMIT ? OFFSET ?`
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
      `SELECT id, content, metadata, embedding, created_at, updated_at FROM memories`
    );

    const scored: SearchResult[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject() as unknown as MemoryRow;
      const memory = this.rowToMemory(row);
      const score = cosineSimilarity(queryEmbedding, memory.embedding);
      if (score >= threshold) {
        scored.push({ memory, score });
      }
    }
    stmt.free();

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  /**
   * Get a single memory by ID.
   */
  getById(id: string): Memory | null {
    const stmt = this.db.prepare(
      `SELECT id, content, metadata, embedding, created_at, updated_at FROM memories WHERE id = ?`
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

  /**
   * Update a memory's content and re-generate its embedding.
   */
  async update(id: string, content: string, metadata?: Record<string, unknown>): Promise<Memory | null> {
    const existing = this.getById(id);
    if (!existing) return null;

    const embedding = await this.embeddings.embed(content);
    const now = new Date().toISOString();
    const newMetadata = metadata ?? existing.metadata;

    this.db.run(
      `UPDATE memories SET content = ?, metadata = ?, embedding = ?, updated_at = ? WHERE id = ?`,
      [content, JSON.stringify(newMetadata), JSON.stringify(embedding), now, id]
    );
    this.persist();

    return { id, content, metadata: newMetadata, embedding, createdAt: existing.createdAt, updatedAt: now };
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

  private rowToMemory(row: MemoryRow): Memory {
    return {
      id: row.id,
      content: row.content,
      metadata: JSON.parse(row.metadata),
      embedding: JSON.parse(row.embedding),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
