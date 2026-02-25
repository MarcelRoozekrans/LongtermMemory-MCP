import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MemoryStore } from "./memory-store.js";

/**
 * Create and configure the MCP server with all tools.
 * Separated from index.ts so integration tests can import it without side effects.
 */
export function createServer(store: MemoryStore, dbPath?: string): McpServer {
  const server = new McpServer({
    name: "longterm-memory",
    version: "1.0.0",
  });

  // ─── Tool: save_memory ──────────────────────────────────────────────────────

  server.tool(
    "save_memory",
    "Save information to long-term memory. The content will be embedded locally and indexed for semantic search. Use this to store facts, decisions, preferences, or any context worth remembering across sessions.",
    {
      content: z.string().describe("The text content to store in memory"),
      metadata: z
        .record(z.unknown())
        .optional()
        .describe("Optional key-value metadata to attach to this memory (e.g. { \"topic\": \"auth\", \"project\": \"api\" })"),
    },
    async ({ content, metadata }) => {
      try {
        const memory = await store.save(content, metadata ?? {});
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  status: "saved",
                  id: memory.id,
                  preview: content.length > 120 ? content.slice(0, 120) + "..." : content,
                  createdAt: memory.createdAt,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error saving memory: ${error}` }],
          isError: true,
        };
      }
    }
  );

  // ─── Tool: search_memory ────────────────────────────────────────────────────

  server.tool(
    "search_memory",
    "Search long-term memory using semantic similarity. The query is embedded locally and compared against all stored memories using cosine similarity. Always search before making decisions to leverage existing knowledge. Search memory proactively at the start of conversations and before answering questions that prior context could inform.",
    {
      query: z
        .string()
        .describe("Natural language search query describing what you're looking for"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(50)
        .optional()
        .default(5)
        .describe("Maximum number of results to return (default: 5)"),
      threshold: z
        .number()
        .min(0)
        .max(1)
        .optional()
        .default(0.3)
        .describe("Minimum similarity score threshold, 0-1 (default: 0.3)"),
    },
    async ({ query, limit, threshold }) => {
      try {
        const results = await store.search(query, limit, threshold);

        if (results.length === 0) {
          return {
            content: [{ type: "text" as const, text: "No relevant memories found." }],
          };
        }

        const formatted = results.map((r, i) => ({
          rank: i + 1,
          score: Math.round(r.score * 1000) / 1000,
          id: r.memory.id,
          content: r.memory.content,
          metadata: r.memory.metadata,
          createdAt: r.memory.createdAt,
        }));

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(formatted, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error searching memories: ${error}` }],
          isError: true,
        };
      }
    }
  );

  // ─── Tool: get_all_memories ─────────────────────────────────────────────────

  server.tool(
    "get_all_memories",
    "Retrieve all stored memories, ordered by most recent first. Use this when you need a broad overview or when semantic search terms are too narrow to find what you need. Results are paginated.",
    {
      limit: z
        .number()
        .int()
        .min(1)
        .max(500)
        .optional()
        .default(50)
        .describe("Maximum number of memories to return (default: 50)"),
      offset: z
        .number()
        .int()
        .min(0)
        .optional()
        .default(0)
        .describe("Number of memories to skip for pagination (default: 0)"),
    },
    async ({ limit, offset }) => {
      try {
        const memories = store.getAll(limit, offset);
        const total = store.count();

        const formatted = memories.map((m) => ({
          id: m.id,
          content: m.content,
          metadata: m.metadata,
          createdAt: m.createdAt,
          updatedAt: m.updatedAt,
        }));

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ total, returned: formatted.length, offset, memories: formatted }, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error retrieving memories: ${error}` }],
          isError: true,
        };
      }
    }
  );

  // ─── Tool: delete_memory ────────────────────────────────────────────────────

  server.tool(
    "delete_memory",
    "Delete a specific memory by its ID. Only delete when the user explicitly requests it or when a memory is confirmed outdated or incorrect.",
    {
      id: z.string().uuid().describe("The UUID of the memory to delete"),
    },
    async ({ id }) => {
      try {
        const deleted = store.delete(id);
        return {
          content: [
            {
              type: "text" as const,
              text: deleted
                ? `Memory ${id} deleted successfully.`
                : `Memory ${id} not found.`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error deleting memory: ${error}` }],
          isError: true,
        };
      }
    }
  );

  // ─── Tool: delete_all_memories ──────────────────────────────────────────────

  server.tool(
    "delete_all_memories",
    "Delete ALL stored memories. This action is irreversible. Only use when the user explicitly asks to clear all memories.",
    {},
    async () => {
      try {
        const count = store.deleteAll();
        return {
          content: [
            {
              type: "text" as const,
              text: `Deleted ${count} memories.`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error deleting memories: ${error}` }],
          isError: true,
        };
      }
    }
  );

  // ─── Tool: memory_stats ─────────────────────────────────────────────────────

  server.tool(
    "memory_stats",
    "Get statistics about the memory store — total count and database location. Use this to check if memories exist before performing operations.",
    {},
    async () => {
      try {
        const total = store.count();
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  totalMemories: total,
                  databasePath: dbPath ?? "unknown",
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error getting stats: ${error}` }],
          isError: true,
        };
      }
    }
  );

  return server;
}
