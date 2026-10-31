import { describe, it, expect, beforeEach } from "vitest";
import { createMockEmbeddings } from "../helpers/mock-embeddings.js";
import { MemoryStore } from "../../src/memory-store.js";
import { ContentGuard } from "../../src/content-guard.js";
import { buildQuery, estimateTokens, formatRecall, rankForProject, recall, recallSettingsFromEnv, RECALL_DEFAULTS } from "../../src/recall.js";
import type { SearchResult } from "../../src/types.js";

// Assembled at runtime so no scanner-flagged literal is committed.
const fakeGhp = "ghp" + "_" + "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8";

function result(content: string, overrides: Partial<SearchResult["memory"]> = {}, score = 0.8): SearchResult {
  return {
    score,
    memory: {
      id: "11111111-2222-3333-4444-555555555555",
      content,
      contentHash: "h",
      metadata: {},
      embedding: [],
      tags: [],
      importance: 5,
      memoryType: "fact",
      createdAt: "2026-10-22T08:00:00.000Z",
      updatedAt: "2026-10-22T08:00:00.000Z",
      lastAccessed: "2026-10-22T08:00:00.000Z",
      ...overrides,
    },
  };
}

describe("recallSettingsFromEnv", () => {
  it("uses the defaults when nothing is set", () => {
    expect(recallSettingsFromEnv({})).toEqual(RECALL_DEFAULTS);
    expect(RECALL_DEFAULTS.enabled).toBe(true);
  });

  it("reads every setting", () => {
    expect(
      recallSettingsFromEnv({
        MEMORY_RECALL_ENABLED: "false",
        MEMORY_RECALL_K: "3",
        MEMORY_RECALL_THRESHOLD: "0.5",
        MEMORY_RECALL_MAX_TOKENS: "200",
      }),
    ).toEqual({ enabled: false, k: 3, threshold: 0.5, maxTokens: 200 });
  });

  it.each(["0", "off", "no", "FALSE"])("treats %s as disabled", (value) => {
    expect(recallSettingsFromEnv({ MEMORY_RECALL_ENABLED: value }).enabled).toBe(false);
  });

  it.each([
    ["MEMORY_RECALL_K", "0"],
    ["MEMORY_RECALL_K", "2.5"],
    ["MEMORY_RECALL_K", "many"],
    ["MEMORY_RECALL_THRESHOLD", "1.5"],
    ["MEMORY_RECALL_THRESHOLD", "-1.5"],
    ["MEMORY_RECALL_MAX_TOKENS", "0"],
    ["MEMORY_RECALL_ENABLED", "maybe"],
  ])("rejects %s=%s and names the variable", (name, value) => {
    expect(() => recallSettingsFromEnv({ [name]: value })).toThrow(name);
  });
});

describe("buildQuery", () => {
  it("uses the trimmed prompt", () => {
    expect(buildQuery("  how do I deploy?  ")).toBe("how do I deploy?");
  });

  it("caps a long prompt", () => {
    expect(buildQuery("x".repeat(5000))).toHaveLength(1000);
  });
});

describe("rankForProject", () => {
  const a = result("about something else", { id: "a" }, 0.6);
  const b = result("the docker stack deploys from git", { id: "b" }, 0.58);

  it("ranks a memory that names the project higher", () => {
    expect(rankForProject([a, b], "docker", 0.5).map((r) => r.memory.id)).toEqual(["b", "a"]);
  });

  it("matches the project in tags and metadata too, ignoring case", () => {
    const tagged = result("x", { id: "t", tags: ["Docker"] }, 0.58);
    const meta = result("y", { id: "m", metadata: { project: "DOCKER" } }, 0.58);
    expect(rankForProject([a, tagged, meta], "docker", 0.5).map((r) => r.memory.id).slice(0, 2).sort()).toEqual(["m", "t"]);
  });

  it("does not match the project inside another word", () => {
    const other = result("dockerfile linting", { id: "o" }, 0.58);
    expect(rankForProject([a, other], "docker", 0.5).map((r) => r.memory.id)).toEqual(["a", "o"]);
  });

  it("lets the boost lift a project memory over the threshold, and drops the rest below it", () => {
    const near = result("docker note", { id: "near" }, 0.47);
    const low = result("other note", { id: "low" }, 0.47);
    expect(rankForProject([near, low], "docker", 0.5).map((r) => r.memory.id)).toEqual(["near"]);
  });

  it("only applies the threshold without a project", () => {
    expect(rankForProject([b, a, result("low", {}, 0.1)], "", 0.5).map((r) => r.memory.id)).toEqual(["a", "b"]);
  });
});

describe("formatRecall", () => {
  const guard = new ContentGuard();
  const settings = { ...RECALL_DEFAULTS };

  it("returns an empty string for no results", () => {
    expect(formatRecall([], guard, settings)).toBe("");
  });

  it("writes one line per memory with date, type, summary and id", () => {
    const text = formatRecall([result("Use node:sqlite with WAL.\nNot sql.js.")], guard, settings);
    const lines = text.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/long-term memor/i);
    expect(lines[1]).toBe("- [2026-10-22 fact] Use node:sqlite with WAL. Not sql.js. (id 11111111-2222-3333-4444-555555555555)");
  });

  it("shortens a long memory to a one-line summary", () => {
    const text = formatRecall([result("word ".repeat(200))], guard, settings);
    const line = text.split("\n")[1];
    expect(line.length).toBeLessThan(300);
    expect(line).toContain("…");
  });

  it("injects at most k lines", () => {
    const results = Array.from({ length: 8 }, (_, i) => result(`memory ${i}`, { id: `id-${i}` }));
    const text = formatRecall(results, guard, { ...settings, k: 3 });
    expect(text.split("\n")).toHaveLength(1 + 3);
  });

  it("stays within the token cap, dropping whole lines", () => {
    const results = Array.from({ length: 5 }, (_, i) => result(`memory number ${i} `.repeat(10), { id: `id-${i}` }));
    const text = formatRecall(results, guard, { ...settings, maxTokens: 120 });
    expect(estimateTokens(text)).toBeLessThanOrEqual(120);
    expect(text.split("\n").length).toBeGreaterThan(1);
    expect(text.split("\n").length).toBeLessThan(6);
    for (const line of text.split("\n").slice(1)) expect(line).toMatch(/\(id id-\d\)$/);
  });

  it("returns an empty string when not even one line fits the cap", () => {
    expect(formatRecall([result("a memory")], guard, { ...settings, maxTokens: 5 })).toBe("");
  });

  it("skips a stored memory that fails the content guard, such as one saved before the guard existed", () => {
    const text = formatRecall([result(`old note, token ${fakeGhp}`, { id: "leaky" }), result("clean note", { id: "clean" })], guard, settings);
    expect(text).not.toContain(fakeGhp);
    expect(text).not.toContain("leaky");
    expect(text).toContain("clean note");
  });

  it("returns an empty string when every match fails the guard", () => {
    expect(formatRecall([result(`token ${fakeGhp}`)], guard, settings)).toBe("");
  });
});

describe("recall", () => {
  let store: MemoryStore;

  beforeEach(async () => {
    store = new MemoryStore({ dbPath: ":memory:" }, createMockEmbeddings());
    await store.init();
  });

  it("returns an empty string for an empty store", async () => {
    expect(await recall(store, new ContentGuard(), "anything", "", RECALL_DEFAULTS)).toBe("");
  });

  it("returns an empty string when nothing passes the threshold", async () => {
    await store.save("unrelated memory");
    expect(await recall(store, new ContentGuard(), "something else", "", { ...RECALL_DEFAULTS, threshold: 0.99 })).toBe("");
  });

  it("finds a matching memory", async () => {
    const saved = await store.save("deploys go through a pull request", {}, [], 5, "preference");
    const text = await recall(store, new ContentGuard(), "deploys go through a pull request", "", RECALL_DEFAULTS);
    expect(text).toContain(`preference] deploys go through a pull request (id ${saved.id})`);
  });

  it("still fills k lines when a match is skipped by the guard", async () => {
    // A permissive store guard lets the secret in, as a pre-guard release would have.
    const legacy = new MemoryStore({ dbPath: ":memory:" }, createMockEmbeddings(), undefined, new ContentGuard({ disabled: ["all"] }));
    await legacy.init();
    await legacy.save(`same ${fakeGhp}`);
    await legacy.save("same a");
    await legacy.save("same b");
    const text = await recall(legacy, new ContentGuard(), "same", "", { ...RECALL_DEFAULTS, k: 2, threshold: -1 });
    expect(text.split("\n")).toHaveLength(3);
    expect(text).not.toContain(fakeGhp);
  });
});
