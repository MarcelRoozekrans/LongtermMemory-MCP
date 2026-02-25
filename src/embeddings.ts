import type { EmbeddingConfig } from "./types.js";

// Dynamic import type for @xenova/transformers
let pipeline: any;
let extractor: any;

/**
 * Local embedding engine using @xenova/transformers.
 * Runs the all-MiniLM-L6-v2 model entirely locally via ONNX Runtime.
 * No cloud API calls — all computation happens on your machine.
 */
export class LocalEmbeddings {
  private model: string;
  private cacheDir?: string;
  private initialized = false;

  constructor(config?: Partial<EmbeddingConfig>) {
    this.model = config?.model ?? "Xenova/all-MiniLM-L6-v2";
    this.cacheDir = config?.cacheDir;
  }

  /**
   * Lazily initialize the embedding pipeline.
   * The model is downloaded on first use and cached locally.
   */
  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;

    const transformers = await import("@xenova/transformers");
    pipeline = transformers.pipeline;

    if (this.cacheDir) {
      transformers.env.cacheDir = this.cacheDir;
    }

    extractor = await pipeline("feature-extraction", this.model, {
      quantized: true, // Use quantized model for speed + smaller size
    });

    this.initialized = true;
  }

  /**
   * Generate an embedding vector for the given text.
   */
  async embed(text: string): Promise<number[]> {
    await this.ensureInitialized();

    const output = await extractor(text, {
      pooling: "mean",
      normalize: true,
    });

    return Array.from(output.data as Float32Array);
  }

  /**
   * Generate embeddings for multiple texts in batch.
   */
  async embedBatch(texts: string[]): Promise<number[][]> {
    await this.ensureInitialized();

    const results: number[][] = [];
    for (const text of texts) {
      results.push(await this.embed(text));
    }
    return results;
  }
}

/**
 * Compute cosine similarity between two vectors.
 * Returns a value between -1 and 1, where 1 means identical direction.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(
      `Vector dimension mismatch: ${a.length} vs ${b.length}`
    );
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;

  return dotProduct / denominator;
}
