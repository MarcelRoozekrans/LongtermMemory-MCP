#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { MemoryStore } from "./memory-store.js";
import { BackupManager } from "./backup.js";
import { createServer } from "./server.js";
import os from "os";
import path from "path";

const DEFAULT_DB_DIR = path.join(os.homedir(), ".longterm-memory-mcp");
const DB_PATH = process.env.MEMORY_DB_PATH ?? path.join(DEFAULT_DB_DIR, "memories.db");
const BACKUP_PATH = process.env.MEMORY_BACKUP_PATH ?? path.join(path.dirname(DB_PATH), "backups");

async function main(): Promise<void> {
  const backupManager = new BackupManager(DB_PATH, BACKUP_PATH);
  const store = new MemoryStore({ dbPath: DB_PATH }, undefined, backupManager);
  await store.init();

  const server = createServer(store, DB_PATH);
  const transport = new StdioServerTransport();
  await server.connect(transport);

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
