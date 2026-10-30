#!/usr/bin/env node
/**
 * UserPromptSubmit hook for the longterm-memory plugin.
 *
 * Runs on every prompt, so it stays cheap: plain Node, no dependencies. It starts the recall CLI
 * (`npx longterm-memory-mcp@<plugin version> recall --hook`) only on the first prompt of a session;
 * the CLI claims the session, and later prompts stop here once the claim's marker file exists.
 * The gate also writes the marker after the CLI exits, so a version without `recall`, or a failed
 * download, still costs one npx run per session and not one per prompt.
 * The path rules below repeat src/paths.ts and src/recall-session.ts; tests/unit/recall-gate.test.ts keeps them equal.
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const CHILD_TIMEOUT_MS = 50_000;

export function gateMarkerFile(env, sessionId) {
  const dbPath = env.MEMORY_DB_PATH ?? path.join(os.homedir(), ".longterm-memory-mcp", "memories.db");
  const stateDir = env.MEMORY_RECALL_STATE_DIR ?? path.join(path.dirname(dbPath), "recall-sessions");
  return path.join(stateDir, sessionId.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 128));
}

export function shouldRecall(input, env) {
  if (["0", "false", "off", "no"].includes((env.MEMORY_RECALL_ENABLED ?? "").trim().toLowerCase())) return false;
  if (!input || typeof input.session_id !== "string" || typeof input.prompt !== "string" || input.prompt.trim() === "") return false;
  return !fs.existsSync(gateMarkerFile(env, input.session_id));
}

export function markSession(env, sessionId) {
  const marker = gateMarkerFile(env, sessionId);
  fs.mkdirSync(path.dirname(marker), { recursive: true });
  fs.writeFileSync(marker, "", { flag: "a" });
}

/** The CLI pinned to this plugin's version, so a cached older npx copy is never used. */
export function recallCommand() {
  const manifest = fileURLToPath(new URL("../.claude-plugin/plugin.json", import.meta.url));
  const { version } = JSON.parse(fs.readFileSync(manifest, "utf8"));
  return ["npx", ["-y", `longterm-memory-mcp@${version}`, "recall", "--hook"]];
}

/** Passes on the CLI's answer only when it is a hook reply, so an older version that lacks `recall` injects nothing. */
export function hookReply(stdout) {
  try {
    const reply = JSON.parse(stdout);
    return typeof reply?.hookSpecificOutput?.additionalContext === "string" ? JSON.stringify(reply) : "";
  } catch {
    return "";
  }
}

async function main() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");

  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    return;
  }
  if (!shouldRecall(input, process.env)) return;

  const [command, args] = recallCommand();
  const child = spawn(command, args, { stdio: ["pipe", "pipe", "inherit"], shell: process.platform === "win32" });
  const timer = setTimeout(() => child.kill(), CHILD_TIMEOUT_MS);
  let stdout = "";
  child.stdout.setEncoding("utf8").on("data", (data) => (stdout += data));
  child.stdin.on("error", () => {});
  child.stdin.end(raw);
  await new Promise((resolve) => {
    child.on("error", (error) => {
      process.stderr.write(`longterm-memory recall: ${error.message}\n`);
      resolve();
    });
    child.on("close", resolve);
  });
  clearTimeout(timer);
  markSession(process.env, input.session_id);
  process.stdout.write(hookReply(stdout));
}

// Node resolves symlinks for the main module, so compare against the real path.
if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  // Never block or fail the prompt.
  main().catch((error) => process.stderr.write(`longterm-memory recall: ${error.message}\n`));
}
