import { describe, it, expect } from "vitest";
import { DecayEngine, DECAY_CONFIG } from "../../src/decay.js";

describe("DecayEngine", () => {
  const engine = new DecayEngine();

  describe("computeDecay()", () => {
    it("returns same importance when no time has passed", () => {
      const result = engine.computeDecay(5.0, 0, "general");
      expect(result).toBe(5.0);
    });

    it("halves importance after one half-life", () => {
      const result = engine.computeDecay(10.0, 60, "general");
      expect(result).toBeCloseTo(5.0, 1);
    });

    it("never drops below floor for type", () => {
      const result = engine.computeDecay(5.0, 9999, "fact");
      expect(result).toBe(3);
    });

    it("uses type-specific half-life", () => {
      const result = engine.computeDecay(8.0, 10, "ephemeral");
      expect(result).toBeCloseTo(4.0, 1);
    });

    it("rounds to nearest 0.5", () => {
      const result = engine.computeDecay(7.0, 30, "general");
      expect(result % 0.5).toBe(0);
    });
  });

  describe("shouldProtect()", () => {
    it("protects tags containing core", () => {
      expect(engine.shouldProtect(["core", "other"])).toBe(true);
    });

    it("protects tags containing identity", () => {
      expect(engine.shouldProtect(["identity"])).toBe(true);
    });

    it("protects tags containing pinned", () => {
      expect(engine.shouldProtect(["pinned"])).toBe(true);
    });

    it("does not protect regular tags", () => {
      expect(engine.shouldProtect(["personal", "work"])).toBe(false);
    });

    it("does not protect empty tags", () => {
      expect(engine.shouldProtect([])).toBe(false);
    });
  });

  describe("shouldWriteDecay()", () => {
    it("returns true when change >= 0.5", () => {
      expect(engine.shouldWriteDecay(5.0, 4.5)).toBe(true);
    });

    it("returns false when change < 0.5", () => {
      expect(engine.shouldWriteDecay(5.0, 4.8)).toBe(false);
    });
  });

  describe("computeReinforcement()", () => {
    it("accumulates 0.1 per access", () => {
      const result = engine.computeReinforcement(5.0, 0.0);
      expect(result.newAccum).toBeCloseTo(0.1);
      expect(result.shouldWrite).toBe(false);
    });

    it("triggers write when accum reaches 0.5", () => {
      const result = engine.computeReinforcement(5.0, 0.4);
      expect(result.shouldWrite).toBe(true);
      expect(result.newImportance).toBeCloseTo(5.5);
      expect(result.newAccum).toBe(0);
    });

    it("caps importance at 10", () => {
      const result = engine.computeReinforcement(9.8, 0.4);
      expect(result.newImportance).toBeLessThanOrEqual(10);
    });
  });

  describe("config", () => {
    it("has half-life for all memory types", () => {
      expect(DECAY_CONFIG.halfLifeDays.general).toBe(60);
      expect(DECAY_CONFIG.halfLifeDays.conversation).toBe(45);
      expect(DECAY_CONFIG.halfLifeDays.fact).toBe(120);
      expect(DECAY_CONFIG.halfLifeDays.preference).toBe(90);
      expect(DECAY_CONFIG.halfLifeDays.task).toBe(30);
      expect(DECAY_CONFIG.halfLifeDays.ephemeral).toBe(10);
    });

    it("has floor for all memory types", () => {
      expect(DECAY_CONFIG.floors.general).toBe(1);
      expect(DECAY_CONFIG.floors.conversation).toBe(2);
      expect(DECAY_CONFIG.floors.fact).toBe(3);
      expect(DECAY_CONFIG.floors.preference).toBe(2);
      expect(DECAY_CONFIG.floors.task).toBe(1);
      expect(DECAY_CONFIG.floors.ephemeral).toBe(1);
    });
  });
});
