import { describe, it, expect, beforeEach, vi } from "vitest";
import { createMockEmbeddings } from "../helpers/mock-embeddings.js";

vi.mock("fs", () => ({
  default: {
    existsSync: vi.fn().mockReturnValue(false),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    readFileSync: vi.fn(),
  },
  existsSync: vi.fn().mockReturnValue(false),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  readFileSync: vi.fn(),
}));

import { MemoryStore } from "../../src/memory-store.js";

describe("Schema Migration", () => {
  let mockEmbed: ReturnType<typeof createMockEmbeddings>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockEmbed = createMockEmbeddings();
  });

  it("creates schema_meta with version 1 on fresh database", async () => {
    const store = new MemoryStore({ dbPath: "/fake/db.db" }, mockEmbed);
    await store.init();

    expect(store._getSchemaVersion()).toBe(1);
  });

  it("initializes successfully on fresh database", async () => {
    const store = new MemoryStore({ dbPath: "/fake/db.db" }, mockEmbed);
    await store.init();
    expect(store.count()).toBe(0);
    await store.save("test memory");
    expect(store.count()).toBe(1);
  });

  it("wipes and recreates when schema version mismatches", async () => {
    const store = new MemoryStore({ dbPath: "/fake/db.db" }, mockEmbed);
    await store.init();
    await store.save("old memory");
    expect(store.count()).toBe(1);

    // Tamper with schema version to simulate outdated DB
    store._setSchemaVersionForTesting(0);
    expect(store._getSchemaVersion()).toBe(0);

    // Re-run migration — should detect mismatch, wipe memories, recreate
    store._reinitializeForTesting();

    expect(store.count()).toBe(0); // data was wiped
    expect(store._getSchemaVersion()).toBe(1); // version restored
  });

  it("handles legacy database without schema_meta table", async () => {
    const store = new MemoryStore({ dbPath: "/fake/db.db" }, mockEmbed);
    await store.init();
    await store.save("legacy memory");
    expect(store.count()).toBe(1);

    // Drop schema_meta to simulate legacy DB
    store._dropSchemaMetaForTesting();
    expect(store._getSchemaVersion()).toBe(-1);

    // Re-run migration — should detect missing meta, wipe memories, recreate
    store._reinitializeForTesting();

    expect(store.count()).toBe(0); // data was wiped
    expect(store._getSchemaVersion()).toBe(1); // meta table recreated
  });

  it("no-ops when schema version matches", async () => {
    const store = new MemoryStore({ dbPath: "/fake/db.db" }, mockEmbed);
    await store.init();
    await store.save("keep me");
    expect(store.count()).toBe(1);

    // Re-run migration with matching version — data should survive
    store._reinitializeForTesting();

    expect(store.count()).toBe(1); // data preserved
    expect(store._getSchemaVersion()).toBe(1);
  });
});
