import { describe, it, expect, beforeEach, vi } from "vitest";
import { createMockEmbeddings } from "../helpers/mock-embeddings.js";

// Mock fs so MemoryStore never touches disk
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

describe("MemoryStore", () => {
  let store: MemoryStore;
  let mockEmbed: ReturnType<typeof createMockEmbeddings>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockEmbed = createMockEmbeddings();
    // Inject mock embedder directly — no fragile vi.mock on embeddings needed
    store = new MemoryStore({ dbPath: "/fake/memories.db" }, mockEmbed);
    await store.init();
  });

  // ── save ──────────────────────────────────────────────────

  describe("save()", () => {
    it("returns a memory with UUID, content, and embedding", async () => {
      const memory = await store.save("TypeScript is great");
      expect(memory.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      );
      expect(memory.content).toBe("TypeScript is great");
      expect(memory.metadata).toEqual({});
      expect(memory.embedding).toHaveLength(384);
      expect(memory.createdAt).toBeTruthy();
    });

    it("saves with metadata", async () => {
      const memory = await store.save("note", { topic: "testing" });
      expect(memory.metadata).toEqual({ topic: "testing" });
    });

    it("calls embed with the content", async () => {
      await store.save("hello world");
      expect(mockEmbed.embed).toHaveBeenCalledWith("hello world");
    });

    it("increments count", async () => {
      expect(store.count()).toBe(0);
      await store.save("one");
      expect(store.count()).toBe(1);
      await store.save("two");
      expect(store.count()).toBe(2);
    });

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
  });

  // ── getAll ────────────────────────────────────────────────

  describe("getAll()", () => {
    it("returns empty array when store is empty", () => {
      expect(store.getAll()).toEqual([]);
    });

    it("returns memories in reverse chronological order", async () => {
      await store.save("first");
      await store.save("second");
      await store.save("third");

      const all = store.getAll();
      expect(all).toHaveLength(3);
      expect(all[0].content).toBe("third");
      expect(all[2].content).toBe("first");
    });

    it("respects limit", async () => {
      await store.save("a");
      await store.save("b");
      await store.save("c");
      expect(store.getAll(2)).toHaveLength(2);
    });

    it("respects offset", async () => {
      await store.save("a");
      await store.save("b");
      await store.save("c");
      const result = store.getAll(10, 1);
      expect(result).toHaveLength(2);
    });
  });

  // ── getById ───────────────────────────────────────────────

  describe("getById()", () => {
    it("returns null for non-existent ID", () => {
      expect(store.getById("00000000-0000-0000-0000-000000000000")).toBeNull();
    });

    it("returns the correct memory", async () => {
      const saved = await store.save("find me");
      const found = store.getById(saved.id);
      expect(found).not.toBeNull();
      expect(found!.content).toBe("find me");
      expect(found!.id).toBe(saved.id);
    });
  });

  // ── search ────────────────────────────────────────────────

  describe("search()", () => {
    it("returns empty array when store is empty", async () => {
      expect(await store.search("anything")).toEqual([]);
    });

    it("returns results with memory and score", async () => {
      await store.save("TypeScript testing is fun");

      const results = await store.search("TypeScript", 5, 0.0);
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0]).toHaveProperty("memory");
      expect(results[0]).toHaveProperty("score");
      expect(typeof results[0].score).toBe("number");
    });

    it("respects threshold — very high threshold yields no results", async () => {
      await store.save("some content");
      const results = await store.search("unrelated query", 5, 0.999);
      expect(results).toEqual([]);
    });

    it("respects limit", async () => {
      await store.save("one");
      await store.save("two");
      await store.save("three");
      const results = await store.search("test", 1, 0.0);
      expect(results).toHaveLength(1);
    });

    it("sorts results by score descending", async () => {
      await store.save("alpha beta gamma");
      await store.save("delta epsilon zeta");

      const results = await store.search("test query", 10, 0.0);
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
      }
    });
  });

  // ── update ────────────────────────────────────────────────

  describe("update()", () => {
    it("returns null for non-existent ID", async () => {
      const result = await store.update("00000000-0000-0000-0000-000000000000", "new");
      expect(result).toBeNull();
    });

    it("updates content and re-embeds", async () => {
      const saved = await store.save("original");
      const updated = await store.update(saved.id, "modified");

      expect(updated).not.toBeNull();
      expect(updated!.content).toBe("modified");
      expect(updated!.id).toBe(saved.id);
      expect(updated!.contentHash).toBeTruthy();
      expect(mockEmbed.embed).toHaveBeenCalledWith("modified");
    });

    it("preserves metadata when not provided", async () => {
      const saved = await store.save("text", { key: "value" });
      const updated = await store.update(saved.id, "new text");
      expect(updated!.metadata.key).toBe("value");
    });

    it("replaces metadata when provided", async () => {
      const saved = await store.save("text", { key: "old" });
      const updated = await store.update(saved.id, "new", { key: "new" });
      expect(updated!.metadata).toEqual({ key: "new" });
    });

    it("updates the updatedAt timestamp", async () => {
      const saved = await store.save("text");
      await new Promise((r) => setTimeout(r, 10));
      const updated = await store.update(saved.id, "new text");
      expect(updated!.updatedAt).not.toBe(saved.updatedAt);
      expect(updated!.createdAt).toBe(saved.createdAt);
    });
  });

  // ── delete ────────────────────────────────────────────────

  describe("delete()", () => {
    it("returns false for non-existent ID", () => {
      expect(store.delete("00000000-0000-0000-0000-000000000000")).toBe(false);
    });

    it("deletes and returns true", async () => {
      const saved = await store.save("to delete");
      expect(store.delete(saved.id)).toBe(true);
      expect(store.count()).toBe(0);
      expect(store.getById(saved.id)).toBeNull();
    });
  });

  // ── deleteAll ─────────────────────────────────────────────

  describe("deleteAll()", () => {
    it("returns 0 when empty", () => {
      expect(store.deleteAll()).toBe(0);
    });

    it("deletes all and returns count", async () => {
      await store.save("one");
      await store.save("two");
      await store.save("three");
      expect(store.deleteAll()).toBe(3);
      expect(store.count()).toBe(0);
    });
  });

  // ── decay on access ───────────────────────────────────────
  describe("decay on access", () => {
    it("updates lastAccessed when retrieving by id", async () => {
      const saved = await store.save("decay test");
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

  // ── count ─────────────────────────────────────────────────

  describe("count()", () => {
    it("returns 0 for empty store", () => {
      expect(store.count()).toBe(0);
    });

    it("tracks insertions and deletions", async () => {
      const m = await store.save("one");
      expect(store.count()).toBe(1);
      await store.save("two");
      expect(store.count()).toBe(2);
      store.delete(m.id);
      expect(store.count()).toBe(1);
    });
  });
});
