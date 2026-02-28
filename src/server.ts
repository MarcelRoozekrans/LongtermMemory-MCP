import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MemoryStore } from "./memory-store.js";

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

  // ─── Tool: search_memory ────────────────────────────────────────────────────

  server.tool(
    "search_memory",
    "Search long-term memory using semantic similarity. The query is embedded locally and compared against all stored memories using cosine similarity.",
    {
      query: z.string().describe("Natural language search query describing what you're looking for"),
      limit: z.number().int().min(1).max(50).optional().default(5).describe("Maximum number of results to return (default: 5)"),
      threshold: z.number().min(0).max(1).optional().default(0.3).describe("Minimum similarity score threshold, 0-1 (default: 0.3)"),
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
          tags: r.memory.tags,
          importance: r.memory.importance,
          memoryType: r.memory.memoryType,
          createdAt: r.memory.createdAt,
        }));

        return {
          content: [{ type: "text" as const, text: JSON.stringify(formatted, null, 2) }],
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
    "Retrieve all stored memories, ordered by most recent first. Results are paginated.",
    {
      limit: z.number().int().min(1).max(500).optional().default(50).describe("Maximum number of memories to return (default: 50)"),
      offset: z.number().int().min(0).optional().default(0).describe("Number of memories to skip for pagination (default: 0)"),
    },
    async ({ limit, offset }) => {
      try {
        const memories = store.getAll(limit, offset);
        const total = store.count();

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

  // ─── Tool: update_memory ────────────────────────────────────────────────────

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

  // ─── Tool: search_by_type ───────────────────────────────────────────────────

  server.tool(
    "search_by_type",
    "Search memories by category type (e.g. fact, preference, conversation). Returns memories ordered by importance.",
    {
      memory_type: z
        .enum(["general", "fact", "preference", "conversation", "task", "ephemeral"])
        .describe("The memory type to filter by"),
      limit: z.number().int().min(1).max(50).optional().default(20).describe("Maximum number of results (default: 20)"),
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

  // ─── Tool: search_by_tags ───────────────────────────────────────────────────

  server.tool(
    "search_by_tags",
    "Find memories that match any of the provided tags. Returns memories ordered by importance.",
    {
      tags: z.array(z.string()).describe("Tags to search for — matches memories containing ANY of these tags"),
      limit: z.number().int().min(1).max(50).optional().default(20).describe("Maximum number of results (default: 20)"),
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

  // ─── Tool: search_by_date_range ─────────────────────────────────────────────

  server.tool(
    "search_by_date_range",
    "Find memories created within a specific date range. Use ISO date format.",
    {
      date_from: z.string().describe("Start date in ISO format (e.g. \"2026-01-01\" or \"2026-01-01T00:00:00Z\")"),
      date_to: z.string().optional().describe("End date in ISO format (defaults to now)"),
      limit: z.number().int().min(1).max(50).optional().default(50).describe("Maximum number of results (default: 50)"),
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
          content: [{ type: "text" as const, text: `Deleted ${count} memories.` }],
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
    "Get statistics about the memory store — total count and database location.",
    {},
    async () => {
      try {
        const total = store.count();
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ totalMemories: total, databasePath: dbPath ?? "unknown" }, null, 2),
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

  // ─── Tool: create_backup ────────────────────────────────────────────────────

  server.tool(
    "create_backup",
    "Create a manual backup of the memory database and export all memories as JSON.",
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

  return server;
}
