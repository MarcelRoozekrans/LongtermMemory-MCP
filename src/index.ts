#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { MemoryStore } from "./memory-store.js";
import { createServer } from "./server.js";
import os from "os";
import path from "path";

// Default to a user-scoped path so all instances share the same memory.
// Override with MEMORY_DB_PATH for project-specific databases.
const DEFAULT_DB_DIR = path.join(os.homedir(), ".longterm-memory-mcp");
const DB_PATH = process.env.MEMORY_DB_PATH ?? path.join(DEFAULT_DB_DIR, "memories.db");

async function main(): Promise<void> {
  const store = new MemoryStore({ dbPath: DB_PATH });
  await store.init();

  const server = createServer(store, DB_PATH);
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Graceful shutdown
  process.on("SIGINT", () => {
    store.close();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    store.close();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
