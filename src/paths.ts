import os from "os";
import path from "path";

/** The database file: MEMORY_DB_PATH, or ~/.longterm-memory-mcp/memories.db. */
export function resolveDbPath(env: NodeJS.ProcessEnv = process.env): string {
  return env.MEMORY_DB_PATH ?? path.join(os.homedir(), ".longterm-memory-mcp", "memories.db");
}

/** Where the recall hook keeps its once-per-session markers: MEMORY_RECALL_STATE_DIR, or next to the database. */
export function recallStateDir(dbPath: string, env: NodeJS.ProcessEnv = process.env): string {
  return env.MEMORY_RECALL_STATE_DIR ?? path.join(path.dirname(dbPath), "recall-sessions");
}

