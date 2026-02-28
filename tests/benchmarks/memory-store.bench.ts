import { bench, describe, beforeAll, vi } from "vitest";
import { createMockEmbeddings } from "../helpers/mock-embeddings.js";

// Mock fs so MemoryStore never touches disk (same pattern as unit tests)
vi.mock("fs", () => ({
  default: {
    existsSync: vi.fn().mockReturnValue(false),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    readFileSync: vi.fn(),
  },
  existsSync: vi.fn().mockReturnValue(false),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  readFileSync: vi.fn(),
}));

import { MemoryStore } from "../../src/memory-store.js";

// ── Helpers ──────────────────────────────────────────────────────────────

async function createStore(): Promise<MemoryStore> {
  const mockEmbed = createMockEmbeddings();
  const store = new MemoryStore({ dbPath: "/fake/bench.db" }, mockEmbed);
  await store.init();
  return store;
}

async function populateStore(store: MemoryStore, count: number): Promise<string[]> {
  const types = ["general", "fact", "preference", "conversation", "task", "ephemeral"] as const;
  const tagSets = [["work"], ["personal"], ["project", "backend"], ["core"], ["hobby", "fun"]];
  const ids: string[] = [];

  for (let i = 0; i < count; i++) {
    const memory = await store.save(
      `Benchmark memory content number ${i} with unique padding ${Math.random()}`,
      { index: i, category: types[i % types.length] },
      tagSets[i % tagSets.length],
      1 + (i % 10),
      types[i % types.length],
    );
    ids.push(memory.id);
  }
  return ids;
}

// ── Save Operations ──────────────────────────────────────────────────────

describe("save - single memory", () => {
  let counter = 0;

  bench("store.save()", async () => {
    const store = await createStore();
    await store.save(`bench-save-single-${counter++}`);
  });
});

describe("save - batch at scale", () => {
  for (const size of [10, 100]) {
    bench(`save ${size} memories sequentially`, async () => {
      const store = await createStore();
      for (let i = 0; i < size; i++) {
        await store.save(`batch-${size}-${Math.random()}-${i}`);
      }
    }, { time: 1000 });
  }

  for (const size of [500, 1000]) {
    bench(`save ${size} memories sequentially`, async () => {
      const store = await createStore();
      for (let i = 0; i < size; i++) {
        await store.save(`batch-${size}-${Math.random()}-${i}`);
      }
    }, { time: 5000, iterations: 1 });
  }
});

// ── Semantic Search ─────────────────────────────────────────────────────

describe("search - semantic similarity", () => {
  for (const size of [10, 100, 500, 1000]) {
    describe(`store size: ${size}`, () => {
      let store: MemoryStore;

      beforeAll(async () => {
        store = await createStore();
        await populateStore(store, size);
      });

      bench("search (limit=5, threshold=0.3)", async () => {
        await store.search("unique benchmark query text", 5, 0.3);
      });

      bench("search (limit=20, threshold=0.0)", async () => {
        await store.search("another benchmark query", 20, 0.0);
      });
    });
  }
});

// ── Structured Search ───────────────────────────────────────────────────

describe("searchByType", () => {
  for (const size of [10, 100, 500, 1000]) {
    describe(`store size: ${size}`, () => {
      let store: MemoryStore;

      beforeAll(async () => {
        store = await createStore();
        await populateStore(store, size);
      });

      bench("searchByType('fact', 20)", () => {
        store.searchByType("fact", 20);
      });
    });
  }
});

describe("searchByTags", () => {
  for (const size of [10, 100, 500, 1000]) {
    describe(`store size: ${size}`, () => {
      let store: MemoryStore;

      beforeAll(async () => {
        store = await createStore();
        await populateStore(store, size);
      });

      bench("searchByTags (1 tag)", () => {
        store.searchByTags(["work"], 20);
      });

      bench("searchByTags (3 tags)", () => {
        store.searchByTags(["work", "personal", "hobby"], 20);
      });
    });
  }
});

describe("searchByDateRange", () => {
  for (const size of [10, 100, 500, 1000]) {
    describe(`store size: ${size}`, () => {
      let store: MemoryStore;

      beforeAll(async () => {
        store = await createStore();
        await populateStore(store, size);
      });

      const from = new Date(Date.now() - 60000).toISOString();
      const to = new Date(Date.now() + 60000).toISOString();

      bench("searchByDateRange", () => {
        store.searchByDateRange(from, to, 50);
      });
    });
  }
});

// ── CRUD Operations ─────────────────────────────────────────────────────

describe("getAll", () => {
  for (const size of [10, 100, 500, 1000]) {
    describe(`store size: ${size}`, () => {
      let store: MemoryStore;

      beforeAll(async () => {
        store = await createStore();
        await populateStore(store, size);
      });

      bench(`getAll(100)`, () => {
        store.getAll(100, 0);
      });

      bench(`getAll(${size})`, () => {
        store.getAll(size, 0);
      });
    });
  }
});

describe("getById", () => {
  let store: MemoryStore;
  let ids: string[];

  beforeAll(async () => {
    store = await createStore();
    ids = await populateStore(store, 100);
  });

  bench("getById - existing memory", () => {
    store.getById(ids[50]);
  });

  bench("getById - non-existent", () => {
    store.getById("00000000-0000-0000-0000-000000000000");
  });
});

describe("update", () => {
  let updateCounter = 0;

  bench("update content (triggers re-embed)", async () => {
    const store = await createStore();
    const mem = await store.save("original-update-bench");
    await store.update(mem.id, `updated-content-${updateCounter++}`);
  });

  bench("update metadata only (no re-embed)", async () => {
    const store = await createStore();
    const mem = await store.save("original-meta-bench");
    await store.update(mem.id, undefined, { key: "new-value" });
  });
});

describe("delete", () => {
  bench("delete existing memory", async () => {
    const store = await createStore();
    const mem = await store.save("to-delete-bench");
    store.delete(mem.id);
  });
});

describe("count", () => {
  let store: MemoryStore;

  beforeAll(async () => {
    store = await createStore();
    await populateStore(store, 500);
  });

  bench("count() on 500-memory store", () => {
    store.count();
  });
});
