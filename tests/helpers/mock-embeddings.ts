import { vi } from "vitest";

/**
 * Generates a deterministic 384-dim fake embedding from a string.
 * - Same input → same vector (deterministic)
 * - Different inputs → different vectors (enables meaningful search tests)
 * - Normalized to unit length (mimics real model output)
 */
export function fakeEmbedding(text: string): number[] {
  const dim = 384;
  const vec = new Array(dim).fill(0);

  // Seed from text via simple hash
  let seed = 0;
  for (let i = 0; i < text.length; i++) {
    seed = ((seed << 5) - seed + text.charCodeAt(i)) | 0;
  }

  // Fill with mulberry32 PRNG
  for (let i = 0; i < dim; i++) {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    vec[i] = ((t ^ (t >>> 14)) >>> 0) / 4294967296 - 0.5;
  }

  // Normalize to unit length
  const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
  return vec.map((v) => v / norm);
}

/**
 * Creates a mock LocalEmbeddings instance with deterministic embed functions.
 */
export function createMockEmbeddings() {
  return {
    embed: vi.fn(async (text: string) => fakeEmbedding(text)),
    embedBatch: vi.fn(async (texts: string[]) => texts.map(fakeEmbedding)),
  };
}
