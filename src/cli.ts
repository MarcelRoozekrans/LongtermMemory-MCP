/**
 * The `recall` subcommand. Standalone it prints the memories that match a query;
 * with --hook it reads a Claude Code UserPromptSubmit event from stdin and answers with additionalContext,
 * once per session.
 */

import fs from "fs";
import path from "path";
import { parseArgs } from "node:util";
import { MemoryStore } from "./memory-store.js";
import { contentGuardFromEnv } from "./content-guard.js";
import { parseNumber, recall, recallSettingsFromEnv, type RecallSettings } from "./recall.js";
import { claimSession } from "./recall-session.js";
import { recallStateDir, resolveDbPath } from "./paths.js";
import type { Embedder } from "./types.js";

export interface RecallIo {
  env: NodeJS.ProcessEnv;
  cwd: string;
  readStdin: () => Promise<string>;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  /** For tests; the real embedder is used when omitted. */
  embedder?: Embedder;
}

const USAGE = `Usage: longterm-memory-mcp recall [options] <query...>
       longterm-memory-mcp recall --hook   (reads a Claude Code UserPromptSubmit event from stdin)

Options:
  --k <n>            at most n memories (default: MEMORY_RECALL_K or 5)
  --threshold <x>    minimum similarity, -1 to 1 (default: MEMORY_RECALL_THRESHOLD or 0.5)
  --max-tokens <n>   cap on the output, in estimated tokens (default: MEMORY_RECALL_MAX_TOKENS or 400)
  --project <name>   memories naming this project rank higher (default: the current directory's name; "" for none)
`;

interface HookInput {
  session_id?: unknown;
  prompt?: unknown;
  cwd?: unknown;
}

/** Runs `recall` and returns the exit code. */
export async function runRecall(args: string[], io: RecallIo): Promise<number> {
  if (args.includes("--hook")) {
    await runHook(io);
    return 0;
  }

  let settings: RecallSettings;
  let prompt: string;
  let project: string;
  try {
    const { values, positionals } = parseArgs({
      args,
      allowPositionals: true,
      options: {
        k: { type: "string" },
        threshold: { type: "string" },
        "max-tokens": { type: "string" },
        project: { type: "string" },
        help: { type: "boolean", short: "h" },
      },
    });
    if (values.help) {
      io.stdout(USAGE);
      return 0;
    }
    prompt = positionals.join(" ");
    if (prompt.trim() === "") {
      io.stderr(USAGE);
      return 2;
    }
    const env = recallSettingsFromEnv(io.env);
    settings = {
      ...env,
      k: parseNumber("--k", values.k, env.k, { integer: true, min: 1, max: 50 }),
      threshold: parseNumber("--threshold", values.threshold, env.threshold, { min: -1, max: 1 }),
      maxTokens: parseNumber("--max-tokens", values["max-tokens"], env.maxTokens, { integer: true, min: 1 }),
    };
    project = values.project ?? path.basename(io.cwd);
  } catch (error) {
    io.stderr(`${(error as Error).message}\n\n${USAGE}`);
    return 2;
  }

  const text = await recallFromDb(prompt, project, settings, io);
  if (text) io.stdout(text + "\n");
  else io.stderr("No relevant memories found.\n");
  return 0;
}

/** Hook mode never fails the prompt: every problem goes to stderr and the exit code stays 0. */
async function runHook(io: RecallIo): Promise<void> {
  try {
    const input = JSON.parse(await io.readStdin()) as HookInput;
    if (typeof input.session_id !== "string" || typeof input.prompt !== "string" || input.prompt.trim() === "") return;
    let settings: RecallSettings | Error;
    try {
      settings = recallSettingsFromEnv(io.env);
    } catch (error) {
      settings = error as Error;
    }
    if (!(settings instanceof Error) && !settings.enabled) return;

    // Claim before reporting a bad setting, so the plugin gate stops calling us for this session.
    const dbPath = resolveDbPath(io.env);
    if (!claimSession(recallStateDir(dbPath, io.env), input.session_id)) return;
    if (settings instanceof Error) throw settings;

    const cwd = typeof input.cwd === "string" ? input.cwd : io.cwd;
    const text = await recallFromDb(input.prompt, path.basename(cwd), settings, io);
    if (!text) return;
    io.stdout(JSON.stringify({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: text } }));
  } catch (error) {
    io.stderr(`longterm-memory recall: ${(error as Error).message}\n`);
  }
}

/** Recalls from the configured database. A database that does not exist yet means no memories, and is not created. */
async function recallFromDb(prompt: string, project: string, settings: RecallSettings, io: RecallIo): Promise<string> {
  const dbPath = resolveDbPath(io.env);
  if (!fs.existsSync(dbPath)) return "";
  const guard = contentGuardFromEnv(io.env);
  const store = new MemoryStore({ dbPath }, io.embedder, undefined, guard);
  await store.init();
  try {
    return await recall(store, guard, prompt, project, settings);
  } finally {
    store.close();
  }
}
