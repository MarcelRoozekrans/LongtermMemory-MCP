import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { randomUUID, createHash } from "crypto";
import path from "path";
import fs from "fs";
import { LocalEmbeddings, cosineSimilarity } from "./embeddings.js";
import { DecayEngine } from "./decay.js";
import { BackupManager } from "./backup.js";
import type { Embedder, Memory, MemoryRow, MemoryStoreConfig, SearchResult } from "./types.js";

const MEMORY_COLUMNS =
  "id, content, content_hash, metadata, embedding, tags, importance, memory_type, created_at, updated_at, last_accessed";

/**
 * SQLite-backed memory store with local vector search.
 * Uses Node's built-in node:sqlite in WAL mode, so several processes can share one database file:
 * every operation goes to the file, and a write never overwrites what another process saved.
 */
export class MemoryStore {
  private static readonly SCHEMA_VERSION = 1;
  private static readonly BUSY_TIMEOUT_MS = 5000;
  private db!: DatabaseSync;
  private dbPath: string;
  private embeddings: Embedder;
  private decay = new DecayEngine();
  private initialized = false;
  private backup?: BackupManager;

  constructor(config?: Partial<MemoryStoreConfig>, embedder?: Embedder, backupManager?: BackupManager) {
    this.dbPath = config?.dbPath ?? path.join(process.cwd(), "data", "memories.db");
    this.embeddings = embedder ?? new LocalEmbeddings();
    this.backup = backupManager;
  }

  private contentHash(content: string): string {
    return createHash("sha256").update(content).digest("hex");
  }

  private get inMemory(): boolean {
    return this.dbPath === ":memory:";
  }

  /**
   * Initialize the database. Must be called before any operations.
   */
  async init(): Promise<void> {
    if (this.initialized) return;

    if (!this.inMemory) {
      fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
    }

    this.db = new DatabaseSync(this.dbPath, { timeout: MemoryStore.BUSY_TIMEOUT_MS });
    if (!this.inMemory) {
      this.db.exec("PRAGMA journal_mode = WAL");
    }

    this.initializeSchema();
    this.initialized = true;
  }

  /** Run `fn` in a write transaction that holds the database lock from the start. */
  private transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  private tableExists(name: string): boolean {
    return this.db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) !== undefined;
  }

  private readSchemaVersion(): number {
    if (!this.tableExists("schema_meta")) return -1;
    const row = this.db.prepare("SELECT schema_version FROM schema_meta LIMIT 1").get() as
      | { schema_version: number }
      | undefined;
    return row?.schema_version ?? -1;
  }

  private initializeSchema(): void {
    const expectedVersion = MemoryStore.SCHEMA_VERSION;

    // Fast path, without taking the write lock: the common case of an up-to-date database.
    const version = this.readSchemaVersion();
    if (version === expectedVersion) return;

    if (version > expectedVersion) {
      throw new Error(
        `Database ${this.dbPath} has schema version ${version}, newer than this release supports (${expectedVersion}). ` +
          "Upgrade longterm-memory-mcp.",
      );
    }

    // Copy the database before touching existing memories, so a failed migration can be undone by hand.
    if (this.tableExists("memories") && !this.inMemory) {
      this.snapshotTo(`${this.dbPath}.pre-migration-${new Date().toISOString().replace(/[:.]/g, "")}.bak`);
    }

    this.transaction(() => {
      // Another process may have migrated while we waited for the lock.
      if (this.readSchemaVersion() === expectedVersion) return;

      this.createMemoriesTable();
      this.migrateMemoriesTable();
      this.createIndexes();
      this.db.exec("CREATE TABLE IF NOT EXISTS schema_meta (schema_version INTEGER NOT NULL)");
      this.db.exec("DELETE FROM schema_meta");
      this.db.prepare("INSERT INTO schema_meta (schema_version) VALUES (?)").run(expectedVersion);
    });
  }

  private createMemoriesTable(): void {
    this.db.exec(`
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
  }

  /**
   * Bring a memories table written by an older release (v1.0-1.3 had no schema_meta, and added
   * columns by ALTER TABLE) up to the current columns, keeping every row.
   */
  private migrateMemoriesTable(): void {
    const columns = new Set(
      (this.db.prepare("PRAGMA table_info(memories)").all() as Array<{ name: string }>).map((c) => c.name),
    );
    const added: Array<[string, string]> = [
      ["content_hash", "TEXT NOT NULL DEFAULT ''"],
      ["tags", "TEXT NOT NULL DEFAULT '[]'"],
      ["importance", "REAL NOT NULL DEFAULT 5.0"],
      ["memory_type", "TEXT NOT NULL DEFAULT 'general'"],
      ["last_accessed", "TEXT NOT NULL DEFAULT ''"],
    ];
    for (const [name, definition] of added) {
      if (!columns.has(name)) {
        this.db.exec(`ALTER TABLE memories ADD COLUMN ${name} ${definition}`);
      }
    }

    const missingHash = this.db.prepare("SELECT id, content FROM memories WHERE content_hash = ''").all() as Array<{
      id: string;
      content: string;
    }>;
    const setHash = this.db.prepare("UPDATE memories SET content_hash = ? WHERE id = ?");
    for (const row of missingHash) {
      setHash.run(this.contentHash(row.content), row.id);
    }
    this.db.exec("UPDATE memories SET last_accessed = updated_at WHERE last_accessed = ''");
  }

  private createIndexes(): void {
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_memories_created_at ON memories(created_at)");
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_memories_content_hash ON memories(content_hash)");
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_memories_memory_type ON memories(memory_type)");
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_memories_importance ON memories(importance)");
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_memories_last_accessed ON memories(last_accessed)");
  }

  /** Write a consistent copy of the database, including what is still in the WAL, to `destination`. */
  private snapshotTo(destination: string): void {
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    // VACUUM INTO refuses an existing file; backups made within the same second share a folder.
    fs.rmSync(destination, { force: true });
    this.db.prepare("VACUUM INTO ?").run(destination);
  }

  private findDuplicate(hash: string, excludeId?: string): string | undefined {
    const row = this.db
      .prepare("SELECT id FROM memories WHERE content_hash = ? AND id IS NOT ? LIMIT 1")
      .get(hash, excludeId ?? null) as { id: string } | undefined;
    return row?.id;
  }

  private selectMemories(where: string, ...params: SQLInputValue[]): Memory[] {
    const rows = this.db.prepare(`SELECT ${MEMORY_COLUMNS} FROM memories ${where}`).all(...params) as unknown as MemoryRow[];
    return rows.map((row) => this.rowToMemory(row));
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

    // Cheap check first, so a duplicate does not cost an embedding.
    const duplicate = this.findDuplicate(hash);
    if (duplicate) throw new Error(`Duplicate content detected (existing memory: ${duplicate})`);

    const id = randomUUID();
    const embedding = await this.embeddings.embed(content);
    const now = new Date().toISOString();

    this.transaction(() => {
      // Check again under the lock: another process may have saved the same content meanwhile.
      const raced = this.findDuplicate(hash);
      if (raced) throw new Error(`Duplicate content detected (existing memory: ${raced})`);
      this.db
        .prepare(`INSERT INTO memories (${MEMORY_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, content, hash, JSON.stringify(metadata), JSON.stringify(embedding), JSON.stringify(tags), clampedImportance, memoryType, now, now, now);
    });
    this.maybeBackup();

    return { id, content, contentHash: hash, metadata, embedding, tags, importance: clampedImportance, memoryType, createdAt: now, updatedAt: now, lastAccessed: now };
  }

  /**
   * Retrieve all memories, ordered by most recent first.
   */
  getAll(limit = 100, offset = 0): Memory[] {
    return this.selectMemories("ORDER BY created_at DESC LIMIT ? OFFSET ?", limit, offset);
  }

  /**
   * Search memories using semantic similarity.
   * Generates an embedding for the query and ranks all memories by cosine similarity.
   */
  async search(query: string, limit = 5, threshold = 0.3): Promise<SearchResult[]> {
    const queryEmbedding = await this.embeddings.embed(query);

    const candidates: { memory: Memory; score: number }[] = [];
    for (const memory of this.selectMemories("")) {
      const score = cosineSimilarity(queryEmbedding, memory.embedding);
      if (score >= threshold) {
        candidates.push({ memory, score });
      }
    }

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
    const [memory] = this.selectMemories("WHERE id = ?", id);
    return memory ? this.applyDecayAndReinforcement(memory) : null;
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
    const contentChanged = content != null && content !== existing.content;

    if (contentChanged) {
      newHash = this.contentHash(content);
      const duplicate = this.findDuplicate(newHash, id);
      if (duplicate) throw new Error(`Duplicate content detected (existing memory: ${duplicate})`);
      newEmbedding = await this.embeddings.embed(content);
    }

    const changes = this.transaction(() => {
      if (contentChanged) {
        const raced = this.findDuplicate(newHash, id);
        if (raced) throw new Error(`Duplicate content detected (existing memory: ${raced})`);
      }
      return this.db
        .prepare(
          `UPDATE memories SET content = ?, content_hash = ?, metadata = ?, embedding = ?, tags = ?, importance = ?, memory_type = ?, updated_at = ?, last_accessed = ?
           WHERE id = ?`,
        )
        .run(newContent, newHash, JSON.stringify(newMetadata), JSON.stringify(newEmbedding), JSON.stringify(newTags), newImportance, newMemoryType, now, now, id)
        .changes;
    });
    // Another process deleted it while we were embedding.
    if (changes === 0) return null;

    return {
      id, content: newContent, contentHash: newHash, metadata: newMetadata, embedding: newEmbedding,
      tags: newTags, importance: newImportance, memoryType: newMemoryType,
      createdAt: existing.createdAt, updatedAt: now, lastAccessed: now,
    };
  }

  /**
   * Search memories by their type (e.g. "fact", "preference", "general").
   */
  searchByType(memoryType: string, limit = 20): Memory[] {
    return this.selectMemories("WHERE memory_type = ? ORDER BY importance DESC, created_at DESC LIMIT ?", memoryType, limit);
  }

  /**
   * Search memories that have any of the provided tags.
   */
  searchByTags(tags: string[], limit = 20): Memory[] {
    const conditions = tags.map(() => `tags LIKE ?`).join(" OR ");
    const params = tags.map((tag) => `%"${tag}"%`);
    return this.selectMemories(`WHERE ${conditions} ORDER BY importance DESC, created_at DESC LIMIT ?`, ...params, limit);
  }

  /**
   * Search memories created within a date range.
   */
  searchByDateRange(dateFrom: string, dateTo?: string, limit = 50): Memory[] {
    const to = dateTo ?? new Date().toISOString();
    return this.selectMemories("WHERE created_at BETWEEN ? AND ? ORDER BY created_at DESC LIMIT ?", dateFrom, to, limit);
  }

  /**
   * Delete a memory by ID.
   */
  delete(id: string): boolean {
    return this.db.prepare(`DELETE FROM memories WHERE id = ?`).run(id).changes > 0;
  }

  /**
   * Delete all memories.
   */
  deleteAll(): number {
    return Number(this.db.prepare(`DELETE FROM memories`).run().changes);
  }

  /**
   * Get total memory count.
   */
  count(): number {
    const row = this.db.prepare(`SELECT COUNT(*) as count FROM memories`).get() as { count: number };
    return row.count;
  }

  /**
   * Trigger a manual backup. Returns null if no BackupManager is configured.
   */
  createBackup(): { backupPath: string; memoriesBackedUp: number; timestamp: string } | null {
    if (!this.backup) return null;
    return this.backup.createBackup(this.exportable(), (destination) => this.snapshotTo(destination));
  }

  /**
   * Close the database connection.
   */
  close(): void {
    if (!this.initialized) return;
    this.db.close();
    this.initialized = false;
  }

  private exportable(): Array<Record<string, unknown>> {
    return this.getAll(10000, 0).map((m) => ({
      id: m.id, content: m.content, tags: m.tags, importance: m.importance,
      memoryType: m.memoryType, metadata: m.metadata, createdAt: m.createdAt, updatedAt: m.updatedAt,
    }));
  }

  private maybeBackup(): void {
    if (!this.backup) return;
    if (this.backup.shouldBackup(this.count())) {
      this.backup.createBackup(this.exportable(), (destination) => this.snapshotTo(destination));
    }
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
    }

    // Reinforcement
    const currentAccum = (memory.metadata as Record<string, unknown>).reinforcement_accum as number ?? 0;
    const reinforcement = this.decay.computeReinforcement(currentImportance, currentAccum);
    if (reinforcement.shouldWrite && reinforcement.newImportance != null) {
      currentImportance = reinforcement.newImportance;
    }

    const newMeta = { ...memory.metadata, reinforcement_accum: reinforcement.newAccum };
    const nowIso = now.toISOString();
    this.db
      .prepare(`UPDATE memories SET importance = ?, metadata = ?, last_accessed = ? WHERE id = ?`)
      .run(currentImportance, JSON.stringify(newMeta), nowIso, memory.id);

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

  /** @internal Exposed for testing only — returns the current schema version from DB. */
  _getSchemaVersion(): number {
    return this.readSchemaVersion();
  }

  /** @internal Exposed for testing only — sets schema version to simulate old DB. */
  _setSchemaVersionForTesting(version: number): void {
    this.db.prepare("UPDATE schema_meta SET schema_version = ?").run(version);
  }

  /** @internal Exposed for testing only — drops schema_meta to simulate legacy DB. */
  _dropSchemaMetaForTesting(): void {
    this.db.exec("DROP TABLE IF EXISTS schema_meta");
  }

  /** @internal Exposed for testing only — re-runs schema initialization to test migration paths. */
  _reinitializeForTesting(): void {
    this.initializeSchema();
  }
}
