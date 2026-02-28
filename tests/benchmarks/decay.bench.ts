import { bench, describe } from "vitest";
import { DecayEngine } from "../../src/decay.js";

const engine = new DecayEngine();

describe("DecayEngine.computeDecay", () => {
  const memoryTypes = ["general", "conversation", "fact", "preference", "task", "ephemeral"] as const;

  bench("single computation", () => {
    engine.computeDecay(7.5, 30, "general");
  });

  bench("1000 computations - mixed types", () => {
    for (let i = 0; i < 1000; i++) {
      engine.computeDecay(
        1 + (i % 10),
        i % 365,
        memoryTypes[i % memoryTypes.length],
      );
    }
  });

  bench("10000 computations - worst case (high daysIdle)", () => {
    for (let i = 0; i < 10000; i++) {
      engine.computeDecay(10, 9999, "ephemeral");
    }
  });
});

describe("DecayEngine.computeReinforcement", () => {
  bench("single computation - no writeback", () => {
    engine.computeReinforcement(5.0, 0.0);
  });

  bench("single computation - triggers writeback", () => {
    engine.computeReinforcement(5.0, 0.4);
  });

  bench("1000 computations - mixed accum values", () => {
    for (let i = 0; i < 1000; i++) {
      engine.computeReinforcement(
        1 + (i % 10),
        (i % 5) * 0.1,
      );
    }
  });
});

describe("DecayEngine.shouldProtect", () => {
  const regularTags = ["personal", "work", "project"];
  const protectedTags = ["core", "identity", "pinned"];

  bench("regular tags (no protection)", () => {
    engine.shouldProtect(regularTags);
  });

  bench("protected tags (early exit)", () => {
    engine.shouldProtect(protectedTags);
  });
});
