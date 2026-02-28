export interface Memory {
  id: string;
  content: string;
  contentHash: string;
  metadata: Record<string, unknown>;
  embedding: number[];
  tags: string[];
  importance: number;
  memoryType: string;
  createdAt: string;
  updatedAt: string;
  lastAccessed: string;
}

export interface MemoryRow {
  id: string;
  content: string;
  content_hash: string;
  metadata: string;
  embedding: string;
  tags: string;
  importance: number;
  memory_type: string;
  created_at: string;
  updated_at: string;
  last_accessed: string;
}

export interface SearchResult {
  memory: Memory;
  score: number;
}

export interface MemoryStoreConfig {
  dbPath: string;
  backupPath?: string;
}

export interface EmbeddingConfig {
  model: string;
  cacheDir?: string;
}

/** Minimal interface for embedding providers — enables dependency injection for testing. */
export interface Embedder {
  embed(text: string): Promise<number[]>;
}

/** Valid memory types. */
export const MEMORY_TYPES = ["general", "fact", "preference", "conversation", "task", "ephemeral"] as const;
export type MemoryType = (typeof MEMORY_TYPES)[number];
