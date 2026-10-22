// Generates tests/fixtures/*.db with the pre-node:sqlite code. Kept for reference: it needs a v1.4.2 checkout,
// built with `npm run build`, where sql.js is still a dependency. Run it from the repo root.
import initSqlJs from "sql.js";
import fs from "fs";
import { createHash } from "crypto";
import { MemoryStore } from "./dist/memory-store.js";

function fakeEmbedding(text) {
  const dim = 384; const vec = new Array(dim).fill(0); let seed = 0;
  for (let i = 0; i < text.length; i++) seed = ((seed << 5) - seed + text.charCodeAt(i)) | 0;
  for (let i = 0; i < dim; i++) { seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    vec[i] = ((t ^ (t >>> 14)) >>> 0) / 4294967296 - 0.5; }
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)); return vec.map((v) => v / norm);
}
const embedder = { embed: async (t) => fakeEmbedding(t), embedBatch: async (ts) => ts.map(fakeEmbedding) };

// 1. A v1 database written by the sql.js MemoryStore of v1.4.2.
const v1 = "tests/fixtures/sqljs-v1.db"; fs.rmSync(v1, { force: true });
const store = new MemoryStore({ dbPath: v1 }, embedder); await store.init();
await store.save("Prefer pnpm over npm in monorepos", { project: "fixture" }, ["tooling"], 7, "preference");
await store.save("The staging cluster runs Kubernetes 1.31", {}, ["infra"], 5, "fact");
await store.save("Rotate the API keys every quarter", {}, ["security", "permanent"], 9, "task");
store.close();

// 2. A legacy database as written by v1.0-1.3: no schema_meta, columns added by ALTER.
const SQL = await initSqlJs(); const db = new SQL.Database();
db.run(`CREATE TABLE memories (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        metadata TEXT NOT NULL DEFAULT '{}',
        embedding TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`);
db.run("CREATE INDEX idx_memories_created_at ON memories(created_at)\n    ");
// The oldest rows predate the ALTERs, so they get the "" defaults.
const old = [
  ["00000000-0000-4000-8000-000000000001", "Home Assistant runs on the NUC in the hallway", '{"topic":"infrastructure"}', "2026-02-26T17:39:36.223Z"],
  ["00000000-0000-4000-8000-000000000002", "The router baseline latency is 2 ms", "{}", "2026-03-01T09:00:00.000Z"],
];
for (const [id, c, m, t] of old) db.run("INSERT INTO memories VALUES (?,?,?,?,?,?)", [id, c, m, JSON.stringify(fakeEmbedding(c)), t, t]);
db.run(`ALTER TABLE memories ADD COLUMN content_hash TEXT NOT NULL DEFAULT ""`);
db.run(`ALTER TABLE memories ADD COLUMN tags TEXT NOT NULL DEFAULT '[]'`);
db.run(`ALTER TABLE memories ADD COLUMN importance REAL NOT NULL DEFAULT 5.0`);
db.run(`ALTER TABLE memories ADD COLUMN memory_type TEXT NOT NULL DEFAULT 'general'`);
db.run(`ALTER TABLE memories ADD COLUMN last_accessed TEXT NOT NULL DEFAULT ""`);
for (const ix of ["content_hash", "memory_type", "importance", "last_accessed"]) db.run(`CREATE INDEX idx_memories_${ix} ON memories(${ix})`);
// Later rows were written by code that knew all columns.
const c3 = "Use conventional commits in every repository";
db.run(`INSERT INTO memories (id, content, metadata, embedding, created_at, updated_at, content_hash, tags, importance, memory_type, last_accessed)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
  ["00000000-0000-4000-8000-000000000003", c3, '{"reinforcement_accum":0.4}', JSON.stringify(fakeEmbedding(c3)),
   "2026-08-12T10:28:16.494Z", "2026-08-12T10:28:16.494Z", createHash("sha256").update(c3).digest("hex"), '["git"]', 3, "preference", "2026-08-12T10:28:16.494Z"]);
fs.writeFileSync("tests/fixtures/legacy-no-schema-meta.db", Buffer.from(db.export()));
console.log("ok");
