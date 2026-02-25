export interface Memory {
  id: string;
  content: string;
  metadata: Record<string, unknown>;
  embedding: number[];
  createdAt: string;
  updatedAt: string;
}

export interface MemoryRow {
  id: string;
  content: string;
  metadata: string;
  embedding: string;
  created_at: string;
  updated_at: string;
}

export interface SearchResult {
  memory: Memory;
  score: number;
}

export interface MemoryStoreConfig {
  dbPath: string;
}

export interface EmbeddingConfig {
  model: string;
  cacheDir?: string;
}

/** Minimal interface for embedding providers — enables dependency injection for testing. */
export interface Embedder {
  embed(text: string): Promise<number[]>;
}
