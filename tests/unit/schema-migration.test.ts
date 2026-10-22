import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { createMockEmbeddings } from "../helpers/mock-embeddings.js";
import { MemoryStore } from "../../src/memory-store.js";

const FIXTURES = path.join(import.meta.dirname, "..", "fixtures");
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

describe("Schema Migration", () => {
  let mockEmbed: ReturnType<typeof createMockEmbeddings>;
  let tmpDir: string;
  let stores: MemoryStore[];

  /** Copy a fixture into the temp dir, so tests never write to the committed file. */
  function fixture(name: string): string {
    const dbPath = path.join(tmpDir, "memories.db");
    fs.copyFileSync(path.join(FIXTURES, name), dbPath);
    return dbPath;
  }

  async function open(dbPath: string): Promise<MemoryStore> {
    const store = new MemoryStore({ dbPath }, mockEmbed);
    stores.push(store);
    await store.init();
    return store;
  }

  beforeEach(() => {
    mockEmbed = createMockEmbeddings();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "schema-migration-"));
    stores = [];
  });

  afterEach(() => {
    for (const store of stores) store.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates schema_meta with version 1 on fresh database", async () => {
    const store = await open(path.join(tmpDir, "nested", "memories.db"));
    expect(store._getSchemaVersion()).toBe(1);
    expect(store.count()).toBe(0);
    await store.save("test memory");
    expect(store.count()).toBe(1);
  });

  it("puts a file database in WAL mode", async () => {
    const dbPath = path.join(tmpDir, "memories.db");
    await open(dbPath);
    const db = new DatabaseSync(dbPath, { readOnly: true });
    expect(db.prepare("PRAGMA journal_mode").get()).toEqual({ journal_mode: "wal" });
    db.close();
  });

  it("opens a database written by the sql.js releases unchanged", async () => {
    const dbPath = fixture("sqljs-v1.db");
    const store = await open(dbPath);

    expect(store._getSchemaVersion()).toBe(1);
    expect(store.count()).toBe(3);
    const contents = store.getAll().map((m) => m.content).sort();
    expect(contents).toEqual([
      "Prefer pnpm over npm in monorepos",
      "Rotate the API keys every quarter",
      "The staging cluster runs Kubernetes 1.31",
    ]);
    const [top] = await store.search("Prefer pnpm over npm in monorepos", 1);
    expect(top.memory.tags).toEqual(["tooling"]);
    expect(top.memory.memoryType).toBe("preference");
    // Already current, so no migration and no pre-migration copy.
    expect(fs.readdirSync(tmpDir).filter((f) => f.includes("pre-migration"))).toEqual([]);
  });

  it("migrates a legacy database without schema_meta, keeping every memory", async () => {
    const dbPath = fixture("legacy-no-schema-meta.db");
    const store = await open(dbPath);

    expect(store._getSchemaVersion()).toBe(1);
    expect(store.count()).toBe(3);
    for (const memory of store.getAll()) {
      // Rows from before the ALTERs had "" here; the migration backfills them.
      expect(memory.contentHash).toBe(sha256(memory.content));
      expect(memory.lastAccessed).not.toBe("");
    }
    const old = store.getAll().find((m) => m.id === "00000000-0000-4000-8000-000000000002")!;
    expect(old.metadata).toEqual({});
    expect(old.memoryType).toBe("general");

    // Dedup works on the backfilled hashes.
    await expect(store.save("The router baseline latency is 2 ms")).rejects.toThrow(/Duplicate content/);
    // And the table takes new rows.
    await store.save("A new memory after the migration");
    expect(store.count()).toBe(4);
  });

  it("copies a legacy database aside before migrating it", async () => {
    const dbPath = fixture("legacy-no-schema-meta.db");
    await open(dbPath);

    const [backup] = fs.readdirSync(tmpDir).filter((f) => f.startsWith("memories.db.pre-migration-"));
    expect(backup).toBeDefined();
    const copy = new DatabaseSync(path.join(tmpDir, backup), { readOnly: true });
    expect(copy.prepare("SELECT COUNT(*) AS n FROM memories").get()).toEqual({ n: 3 });
    expect(copy.prepare("SELECT name FROM sqlite_master WHERE name = 'schema_meta'").get()).toBeUndefined();
    copy.close();
  });

  it("keeps the migrated legacy database usable on reopen", async () => {
    const dbPath = fixture("legacy-no-schema-meta.db");
    (await open(dbPath)).close();
    stores = [];
    const reopened = await open(dbPath);
    expect(reopened.count()).toBe(3);
    // Only the first open migrated.
    expect(fs.readdirSync(tmpDir).filter((f) => f.includes("pre-migration"))).toHaveLength(1);
  });

  it("keeps memories when schema_meta is missing", async () => {
    const store = await open(path.join(tmpDir, "memories.db"));
    await store.save("legacy memory");
    store._dropSchemaMetaForTesting();
    expect(store._getSchemaVersion()).toBe(-1);

    store._reinitializeForTesting();

    expect(store.count()).toBe(1);
    expect(store._getSchemaVersion()).toBe(1);
  });

  it("keeps memories on an older schema version", async () => {
    const store = await open(path.join(tmpDir, "memories.db"));
    await store.save("old memory");
    store._setSchemaVersionForTesting(0);

    store._reinitializeForTesting();

    expect(store.count()).toBe(1);
    expect(store._getSchemaVersion()).toBe(1);
  });

  it("refuses a database from a newer release without touching it", async () => {
    const store = await open(path.join(tmpDir, "memories.db"));
    await store.save("future memory");
    store._setSchemaVersionForTesting(2);

    expect(() => store._reinitializeForTesting()).toThrow(/newer than this release supports/);
    expect(store.count()).toBe(1);
    expect(store._getSchemaVersion()).toBe(2);
  });

  it("no-ops when schema version matches", async () => {
    const store = await open(path.join(tmpDir, "memories.db"));
    await store.save("keep me");
    store._reinitializeForTesting();
    expect(store.count()).toBe(1);
    expect(store._getSchemaVersion()).toBe(1);
  });
});
