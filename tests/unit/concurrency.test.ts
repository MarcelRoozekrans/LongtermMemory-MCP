import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { createMockEmbeddings } from "../helpers/mock-embeddings.js";
import { MemoryStore } from "../../src/memory-store.js";

/** Two stores on one file stand in for two MCP server processes, each with its own connection. */
describe("Two MemoryStore instances on one database", () => {
  let tmpDir: string;
  let a: MemoryStore;
  let b: MemoryStore;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "concurrency-"));
    const dbPath = path.join(tmpDir, "memories.db");
    a = new MemoryStore({ dbPath }, createMockEmbeddings());
    b = new MemoryStore({ dbPath }, createMockEmbeddings());
    await a.init();
    await b.init();
  });

  afterEach(() => {
    a.close();
    b.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("each sees what the other saved, and neither overwrites the other", async () => {
    const fromA = await a.save("saved by A");
    expect(b.getById(fromA.id)?.content).toBe("saved by A");

    const fromB = await b.save("saved by B");
    expect(a.getById(fromB.id)?.content).toBe("saved by B");
    expect(a.getById(fromA.id)?.content).toBe("saved by A");
    expect(a.count()).toBe(2);
    expect(b.count()).toBe(2);
  });

  it("finds the other instance's memories in semantic search", async () => {
    await a.save("The deploy runs on Fridays");
    const [hit] = await b.search("The deploy runs on Fridays", 1);
    expect(hit.memory.content).toBe("The deploy runs on Fridays");
  });

  it("rejects a duplicate the other instance saved", async () => {
    await a.save("only once");
    await expect(b.save("only once")).rejects.toThrow(/Duplicate content/);
  });

  it("sees updates and deletes from the other instance", async () => {
    const memory = await a.save("first version");
    await b.update(memory.id, "second version");
    expect(a.getById(memory.id)?.content).toBe("second version");

    expect(b.delete(memory.id)).toBe(true);
    expect(a.getById(memory.id)).toBeNull();
    expect(await a.update(memory.id, "too late")).toBeNull();
  });

  it("keeps every memory under interleaved saves", async () => {
    await Promise.all(
      Array.from({ length: 20 }, (_, i) => (i % 2 === 0 ? a : b).save(`memory ${i}`)),
    );
    expect(a.count()).toBe(20);
    expect(b.getAll(100).map((m) => m.content).sort()).toEqual(
      Array.from({ length: 20 }, (_, i) => `memory ${i}`).sort(),
    );
  });
});
