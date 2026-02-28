import { bench, describe } from "vitest";
import { cosineSimilarity } from "../../src/embeddings.js";
import { fakeEmbedding } from "../helpers/mock-embeddings.js";

describe("cosineSimilarity - 384 dimensions", () => {
  const vecA = fakeEmbedding("benchmark vector alpha");
  const vecB = fakeEmbedding("benchmark vector beta");

  bench("single computation", () => {
    cosineSimilarity(vecA, vecB);
  });

  bench("100 sequential computations", () => {
    for (let i = 0; i < 100; i++) {
      cosineSimilarity(vecA, vecB);
    }
  });

  bench("1000 sequential computations", () => {
    for (let i = 0; i < 1000; i++) {
      cosineSimilarity(vecA, vecB);
    }
  });
});

describe("cosineSimilarity - varying dimensions", () => {
  const makePair = (dim: number) => {
    const a = Array.from({ length: dim }, (_, i) => Math.sin(i * 0.1));
    const b = Array.from({ length: dim }, (_, i) => Math.cos(i * 0.1));
    return { a, b };
  };

  const dims = [128, 384, 768, 1536];

  for (const dim of dims) {
    const { a, b } = makePair(dim);
    bench(`${dim} dimensions`, () => {
      cosineSimilarity(a, b);
    });
  }
});
