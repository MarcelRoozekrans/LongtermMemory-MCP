#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { MemoryStore } from "./memory-store.js";
import { BackupManager } from "./backup.js";
import { createServer } from "./server.js";
import { contentGuardFromEnv } from "./content-guard.js";
import { resolveDbPath } from "./paths.js";
import path from "path";

const DB_PATH = resolveDbPath();
const BACKUP_PATH = process.env.MEMORY_BACKUP_PATH ?? path.join(path.dirname(DB_PATH), "backups");

async function serve(): Promise<void> {
  const backupManager = new BackupManager(DB_PATH, BACKUP_PATH);
  const store = new MemoryStore({ dbPath: DB_PATH }, undefined, backupManager, contentGuardFromEnv());
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

async function recallCommand(args: string[]): Promise<void> {
  const { runRecall } = await import("./cli.js");
  process.exitCode = await runRecall(args, {
    env: process.env,
    cwd: process.cwd(),
    readStdin: async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
      return Buffer.concat(chunks).toString("utf8");
    },
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
  });
}

const [command, ...args] = process.argv.slice(2);
(command === "recall" ? recallCommand(args) : serve()).catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
