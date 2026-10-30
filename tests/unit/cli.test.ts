import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { createMockEmbeddings } from "../helpers/mock-embeddings.js";
import { MemoryStore } from "../../src/memory-store.js";
import { runRecall, type RecallIo } from "../../src/cli.js";

describe("recall CLI", () => {
  let dir: string;
  let dbPath: string;
  let out: string[];
  let err: string[];

  function io(overrides: Partial<RecallIo> = {}): RecallIo {
    return {
      env: { MEMORY_DB_PATH: dbPath },
      cwd: "/work/docker",
      readStdin: async () => "",
      stdout: (s) => out.push(s),
      stderr: (s) => err.push(s),
      embedder: createMockEmbeddings(),
      ...overrides,
    };
  }

  async function seed(...contents: string[]): Promise<void> {
    const store = new MemoryStore({ dbPath }, createMockEmbeddings());
    await store.init();
    for (const c of contents) await store.save(c, {}, [], 5, "fact");
    store.close();
  }

  const hookInput = (sessionId: string, prompt: string) => JSON.stringify({ session_id: sessionId, prompt, cwd: "/work/docker", hook_event_name: "UserPromptSubmit" });

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "recall-cli-"));
    dbPath = path.join(dir, "memories.db");
    out = [];
    err = [];
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  describe("standalone", () => {
    it("prints matching memories for a query", async () => {
      await seed("pin the npx version");
      expect(await runRecall(["--project", "", "pin the npx version"], io())).toBe(0);
      expect(out.join("")).toContain("fact] pin the npx version (id ");
    });

    it("joins several words into one query", async () => {
      await seed("pin the npx version");
      await runRecall(["--project=", "pin", "the", "npx", "version"], io());
      expect(out.join("")).toContain("pin the npx version");
    });

    it("honours --k, --threshold and --max-tokens", async () => {
      await seed("same", "same two", "same three");
      await runRecall(["--project", "", "--k", "2", "--threshold=-1", "same"], io());
      expect(out.join("").trim().split("\n")).toHaveLength(3);

      out = [];
      await runRecall(["--project", "", "--max-tokens", "5", "--threshold=-1", "same"], io());
      expect(out).toEqual([]);
    });

    it("says so on stderr when nothing matches, and exits 0", async () => {
      await seed("something");
      expect(await runRecall(["--threshold", "0.99", "other"], io())).toBe(0);
      expect(out).toEqual([]);
      expect(err.join("")).toMatch(/no relevant memories/i);
    });

    it("works when the hook is disabled", async () => {
      await seed("pin the npx version");
      await runRecall(["--project", "", "pin the npx version"], io({ env: { MEMORY_DB_PATH: dbPath, MEMORY_RECALL_ENABLED: "false" } }));
      expect(out.join("")).toContain("pin the npx version");
    });

    it("does not create a database that does not exist", async () => {
      expect(await runRecall(["anything"], io())).toBe(0);
      expect(fs.existsSync(dbPath)).toBe(false);
    });

    it("exits 2 with usage when the query is missing", async () => {
      expect(await runRecall([], io())).toBe(2);
      expect(err.join("")).toMatch(/usage/i);
    });

    it("exits 2 on a bad option value", async () => {
      expect(await runRecall(["--k", "lots", "q"], io())).toBe(2);
      expect(err.join("")).toContain("--k");
    });
  });

  describe("--hook", () => {
    it("injects the recall as additionalContext on the first prompt", async () => {
      await seed("how do I deploy");
      expect(await runRecall(["--hook"], io({ readStdin: async () => hookInput("s1", "how do I deploy") }))).toBe(0);
      const output = JSON.parse(out.join(""));
      expect(output.hookSpecificOutput.hookEventName).toBe("UserPromptSubmit");
      expect(output.hookSpecificOutput.additionalContext).toContain("fact] how do I deploy");
    });

    it("runs once per session", async () => {
      await seed("how do I deploy");
      await runRecall(["--hook"], io({ readStdin: async () => hookInput("s1", "how do I deploy") }));
      out = [];
      await runRecall(["--hook"], io({ readStdin: async () => hookInput("s1", "how do I deploy") }));
      expect(out).toEqual([]);

      await runRecall(["--hook"], io({ readStdin: async () => hookInput("s2", "how do I deploy") }));
      expect(out.join("")).toContain("additionalContext");
    });

    it("prints nothing when nothing matches", async () => {
      await seed("unrelated");
      expect(await runRecall(["--hook"], io({ readStdin: async () => hookInput("s1", "a question"), env: { MEMORY_DB_PATH: dbPath, MEMORY_RECALL_THRESHOLD: "0.99" } }))).toBe(0);
      expect(out).toEqual([]);
    });

    it("does nothing when disabled, and leaves the session unclaimed", async () => {
      await seed("q");
      const env = { MEMORY_DB_PATH: dbPath, MEMORY_RECALL_ENABLED: "off" };
      await runRecall(["--hook"], io({ env, readStdin: async () => hookInput("s1", "q") }));
      expect(out).toEqual([]);
      await runRecall(["--hook"], io({ readStdin: async () => hookInput("s1", "q") }));
      expect(out.join("")).toContain("additionalContext");
    });

    it("never fails the prompt: bad input, a bad setting or a missing database all exit 0 with no output", async () => {
      for (const [stdin, env] of [
        ["not json", { MEMORY_DB_PATH: dbPath }],
        [JSON.stringify({ prompt: "no session" }), { MEMORY_DB_PATH: dbPath }],
        [hookInput("s9", "q"), { MEMORY_DB_PATH: dbPath, MEMORY_RECALL_K: "lots" }],
        [hookInput("s10", "q"), { MEMORY_DB_PATH: path.join(dir, "missing.db") }],
      ] as const) {
        expect(await runRecall(["--hook"], io({ env, readStdin: async () => stdin }))).toBe(0);
      }
      expect(out).toEqual([]);
      expect(err.join("")).toContain("MEMORY_RECALL_K");
      expect(fs.existsSync(path.join(dir, "missing.db"))).toBe(false);
    });

    it("claims the session before reporting a bad setting, so the error shows once", async () => {
      await seed("q");
      await runRecall(["--hook"], io({ env: { MEMORY_DB_PATH: dbPath, MEMORY_RECALL_K: "lots" }, readStdin: async () => hookInput("s1", "q") }));
      expect(err.join("")).toContain("MEMORY_RECALL_K");
      await runRecall(["--hook"], io({ readStdin: async () => hookInput("s1", "q") }));
      expect(out).toEqual([]);
    });
  });
});
