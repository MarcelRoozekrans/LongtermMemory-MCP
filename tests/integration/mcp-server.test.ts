import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
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

import { createServer } from "../../src/server.js";
import { MemoryStore } from "../../src/memory-store.js";

function getText(result: Awaited<ReturnType<Client["callTool"]>>): string {
  return (result.content as Array<{ type: string; text: string }>)[0].text;
}

describe("MCP Server Integration", () => {
  let client: Client;
  let store: MemoryStore;

  beforeEach(async () => {
    vi.clearAllMocks();

    const mockEmbed = createMockEmbeddings();
    store = new MemoryStore({ dbPath: "/fake/memories.db" }, mockEmbed);
    await store.init();

    const server = createServer(store, "/fake/memories.db");
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await server.connect(serverTransport);
    client = new Client({ name: "test-client", version: "1.0.0" });
    await client.connect(clientTransport);
  });

  afterEach(async () => {
    await client.close();
  });

  // ── tool listing ────────────────────────────────────────────

  describe("tool listing", () => {
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
  });

  // ── save_memory ─────────────────────────────────────────────

  describe("save_memory", () => {
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

    it("truncates long content in preview", async () => {
      const longContent = "x".repeat(200);
      const result = await client.callTool({
        name: "save_memory",
        arguments: { content: longContent },
      });

      const parsed = JSON.parse(getText(result));
      expect(parsed.preview.length).toBeLessThan(longContent.length);
      expect(parsed.preview).toContain("...");
    });

    it("accepts metadata", async () => {
      const result = await client.callTool({
        name: "save_memory",
        arguments: { content: "note", metadata: { topic: "testing" } },
      });
      expect(result.isError).toBeFalsy();
    });

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
  });

  // ── search_memory ───────────────────────────────────────────

  describe("search_memory", () => {
    it("returns 'no results' message for empty store", async () => {
      const result = await client.callTool({
        name: "search_memory",
        arguments: { query: "anything" },
      });
      expect(getText(result)).toBe("No relevant memories found.");
    });

    it("finds saved memories by exact match", async () => {
      const content = "TypeScript is a typed superset of JavaScript";
      await client.callTool({
        name: "save_memory",
        arguments: { content },
      });

      const result = await client.callTool({
        name: "search_memory",
        arguments: { query: content, limit: 5, threshold: 0.0 },
      });

      expect(result.isError).toBeFalsy();
      const parsed = JSON.parse(getText(result));
      expect(parsed).toHaveLength(1);
      expect(parsed[0].content).toBe(content);
      expect(parsed[0].score).toBe(1);
      expect(parsed[0].rank).toBe(1);
    });
  });

  // ── get_all_memories ────────────────────────────────────────

  describe("get_all_memories", () => {
    it("returns empty list initially", async () => {
      const result = await client.callTool({
        name: "get_all_memories",
        arguments: {},
      });

      const parsed = JSON.parse(getText(result));
      expect(parsed.total).toBe(0);
      expect(parsed.memories).toEqual([]);
    });

    it("returns saved memories with pagination info", async () => {
      await client.callTool({ name: "save_memory", arguments: { content: "one" } });
      await client.callTool({ name: "save_memory", arguments: { content: "two" } });

      const result = await client.callTool({
        name: "get_all_memories",
        arguments: { limit: 10, offset: 0 },
      });

      const parsed = JSON.parse(getText(result));
      expect(parsed.total).toBe(2);
      expect(parsed.returned).toBe(2);
      expect(parsed.memories).toHaveLength(2);
    });
  });

  // ── update_memory ───────────────────────────────────────────

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

  // ── search_by_type ──────────────────────────────────────────

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

  // ── search_by_tags ──────────────────────────────────────────

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

  // ── search_by_date_range ────────────────────────────────────

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

  // ── delete_memory ───────────────────────────────────────────

  describe("delete_memory", () => {
    it("reports not found for non-existent id", async () => {
      const result = await client.callTool({
        name: "delete_memory",
        arguments: { id: "00000000-0000-0000-0000-000000000000" },
      });
      expect(getText(result)).toContain("not found");
    });

    it("deletes an existing memory", async () => {
      const saveResult = await client.callTool({
        name: "save_memory",
        arguments: { content: "to delete" },
      });
      const id = JSON.parse(getText(saveResult)).id;

      const deleteResult = await client.callTool({
        name: "delete_memory",
        arguments: { id },
      });
      expect(getText(deleteResult)).toContain("deleted successfully");

      const allResult = await client.callTool({
        name: "get_all_memories",
        arguments: {},
      });
      expect(JSON.parse(getText(allResult)).total).toBe(0);
    });
  });

  // ── delete_all_memories ─────────────────────────────────────

  describe("delete_all_memories", () => {
    it("deletes all and reports count", async () => {
      await client.callTool({ name: "save_memory", arguments: { content: "one" } });
      await client.callTool({ name: "save_memory", arguments: { content: "two" } });

      const result = await client.callTool({
        name: "delete_all_memories",
        arguments: {},
      });
      expect(getText(result)).toContain("Deleted 2 memories");
    });
  });

  // ── memory_stats ────────────────────────────────────────────

  describe("memory_stats", () => {
    it("returns count and db path", async () => {
      const result = await client.callTool({
        name: "memory_stats",
        arguments: {},
      });

      const parsed = JSON.parse(getText(result));
      expect(parsed.totalMemories).toBe(0);
      expect(parsed.databasePath).toBe("/fake/memories.db");
    });

    it("reflects count after saves", async () => {
      await client.callTool({ name: "save_memory", arguments: { content: "one" } });
      await client.callTool({ name: "save_memory", arguments: { content: "two" } });

      const result = await client.callTool({
        name: "memory_stats",
        arguments: {},
      });
      expect(JSON.parse(getText(result)).totalMemories).toBe(2);
    });
  });

  // ── create_backup ───────────────────────────────────────────

  describe("create_backup", () => {
    it("reports backup not configured (no BackupManager in test)", async () => {
      const result = await client.callTool({
        name: "create_backup",
        arguments: {},
      });
      expect(getText(result)).toContain("not configured");
    });
  });
});
