/**
 * Automatic recall: finds the memories that match a prompt and formats them as a short list
 * for a hook to inject into the session.
 */

import { ContentGuard } from "./content-guard.js";
import type { MemoryStore } from "./memory-store.js";
import type { SearchResult } from "./types.js";

export interface RecallSettings {
  /** Whether the hook recalls at all. The standalone CLI ignores this. */
  enabled: boolean;
  /** At most this many memories. */
  k: number;
  /** Minimum cosine similarity, -1 to 1. */
  threshold: number;
  /** Hard cap on the injected block, in estimated tokens. */
  maxTokens: number;
}

export const RECALL_DEFAULTS: Readonly<RecallSettings> = Object.freeze({ enabled: true, k: 5, threshold: 0.5, maxTokens: 400 });

const MAX_PROMPT_CHARS = 1000;
/** Added to the score of a memory that names the current project. */
export const PROJECT_BOOST = 0.05;
const MAX_SUMMARY_CHARS = 200;
const HEADER = "Long-term memories that may be relevant (longterm-memory; search_memory gives the full text):";

/** A rough token count, about 4 characters per token. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Reads MEMORY_RECALL_ENABLED, MEMORY_RECALL_K, MEMORY_RECALL_THRESHOLD and MEMORY_RECALL_MAX_TOKENS. */
export function recallSettingsFromEnv(env: NodeJS.ProcessEnv = process.env): RecallSettings {
  return {
    enabled: parseBoolean("MEMORY_RECALL_ENABLED", env.MEMORY_RECALL_ENABLED, RECALL_DEFAULTS.enabled),
    k: parseNumber("MEMORY_RECALL_K", env.MEMORY_RECALL_K, RECALL_DEFAULTS.k, { integer: true, min: 1, max: 50 }),
    threshold: parseNumber("MEMORY_RECALL_THRESHOLD", env.MEMORY_RECALL_THRESHOLD, RECALL_DEFAULTS.threshold, { min: -1, max: 1 }),
    maxTokens: parseNumber("MEMORY_RECALL_MAX_TOKENS", env.MEMORY_RECALL_MAX_TOKENS, RECALL_DEFAULTS.maxTokens, { integer: true, min: 1 }),
  };
}

export function parseBoolean(name: string, value: string | undefined, fallback: boolean): boolean {
  if (value == null || value.trim() === "") return fallback;
  const v = value.trim().toLowerCase();
  if (["1", "true", "on", "yes"].includes(v)) return true;
  if (["0", "false", "off", "no"].includes(v)) return false;
  throw new Error(`${name} must be true or false, got "${value}"`);
}

export function parseNumber(
  name: string,
  value: string | undefined,
  fallback: number,
  rule: { integer?: boolean; min: number; max?: number },
): number {
  if (value == null || value.trim() === "") return fallback;
  const n = Number(value);
  const valid = Number.isFinite(n) && (!rule.integer || Number.isInteger(n)) && n >= rule.min && (rule.max == null || n <= rule.max);
  if (!valid) {
    const range = rule.max == null ? `at least ${rule.min}` : `between ${rule.min} and ${rule.max}`;
    throw new Error(`${name} must be ${rule.integer ? "an integer" : "a number"} ${range}, got "${value}"`);
  }
  return n;
}

/**
 * The search query: the prompt alone, capped so a pasted log does not dominate.
 * The project name is not embedded with it: a short prompt would then match on the project name alone.
 */
export function buildQuery(prompt: string): string {
  return prompt.trim().slice(0, MAX_PROMPT_CHARS);
}

function namesProject(result: SearchResult, pattern: RegExp): boolean {
  const m = result.memory;
  return pattern.test(m.content) || m.tags.some((t) => pattern.test(t)) || pattern.test(JSON.stringify(m.metadata));
}

/**
 * Ranks the memories that name the project (in content, tags or metadata, as a whole word) PROJECT_BOOST higher,
 * then keeps those at or above the threshold, best first.
 */
export function rankForProject(results: SearchResult[], project: string, threshold: number): SearchResult[] {
  const escaped = project.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = project ? new RegExp(`(?<![A-Za-z0-9])${escaped}(?![A-Za-z0-9])`, "i") : null;
  return results
    .map((r) => (pattern && namesProject(r, pattern) ? { ...r, score: r.score + PROJECT_BOOST } : r))
    .filter((r) => r.score >= threshold)
    .sort((a, b) => b.score - a.score);
}

function summarize(content: string): string {
  const flat = content.replace(/\s+/g, " ").trim();
  return flat.length > MAX_SUMMARY_CHARS ? flat.slice(0, MAX_SUMMARY_CHARS - 1).trimEnd() + "…" : flat;
}

function line(result: SearchResult): string {
  const m = result.memory;
  return `- [${m.createdAt.slice(0, 10)} ${m.memoryType}] ${summarize(m.content)} (id ${m.id})`;
}

/**
 * Formats results as a header plus one line per memory, at most k lines and maxTokens in all.
 * A memory the guard rejects is skipped: the guard checks new writes only, so rows stored before it
 * existed can still hold a secret, and recall must not copy one into a session.
 * Returns "" when no line fits.
 */
export function formatRecall(results: SearchResult[], guard: ContentGuard, settings: RecallSettings): string {
  const lines = [HEADER];
  let tokens = estimateTokens(HEADER);
  for (const result of results) {
    if (lines.length > settings.k) break;
    try {
      guard.check(result.memory.content);
    } catch {
      continue;
    }
    const next = line(result);
    const cost = estimateTokens("\n" + next);
    if (tokens + cost > settings.maxTokens) break;
    lines.push(next);
    tokens += cost;
  }
  return lines.length > 1 ? lines.join("\n") : "";
}

/**
 * Searches the store for the prompt and formats the matches, ranking memories that name the project higher.
 * Fetches extra results so a skipped memory does not leave a gap.
 */
export async function recall(store: MemoryStore, guard: ContentGuard, prompt: string, project: string, settings: RecallSettings): Promise<string> {
  const results = await store.search(buildQuery(prompt), settings.k * 2, settings.threshold - (project ? PROJECT_BOOST : 0));
  return formatRecall(rankForProject(results, project, settings.threshold), guard, settings);
}
