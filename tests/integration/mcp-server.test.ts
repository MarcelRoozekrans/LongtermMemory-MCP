import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
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

import { createServer } from "../../src/server.js";
import { MemoryStore } from "../../src/memory-store.js";

/** Helper to extract the text from a tool result. */
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
    it("exposes all 6 tools", async () => {
      const { tools } = await client.listTools();
      const names = tools.map((t) => t.name).sort();
      expect(names).toEqual([
        "delete_all_memories",
        "delete_memory",
        "get_all_memories",
        "memory_stats",
        "save_memory",
        "search_memory",
      ]);
    });
  });

  // ── save_memory ─────────────────────────────────────────────

  describe("save_memory", () => {
    it("saves and returns status with id", async () => {
      const result = await client.callTool({
        name: "save_memory",
        arguments: { content: "Remember this fact" },
      });

      expect(result.isError).toBeFalsy();
      const parsed = JSON.parse(getText(result));
      expect(parsed.status).toBe("saved");
      expect(parsed.id).toBeTruthy();
      expect(parsed.preview).toBe("Remember this fact");
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

      // Search with the exact same text — deterministic embeddings give cosine similarity = 1.0
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

      // Verify it's gone
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
});
