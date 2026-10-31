import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
// The gate ships with the plugin and has no dependencies, so it repeats a few path rules from src/.
// These tests pin both copies to the same answer.
// @ts-expect-error plain JavaScript module without type declarations
import { gateMarkerFile, hookReply, markSession, recallCommand, shouldRecall } from "../../hooks/recall-gate.mjs";
import { claimSession, markerFile } from "../../src/recall-session.js";
import { resolveDbPath, recallStateDir } from "../../src/paths.js";

describe("recall gate", () => {
  let dir: string;
  let env: NodeJS.ProcessEnv;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "recall-gate-"));
    env = { MEMORY_DB_PATH: path.join(dir, "memories.db") };
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("finds the same marker file as the recall CLI", () => {
    for (const e of [env, { MEMORY_RECALL_STATE_DIR: path.join(dir, "state") }, {}]) {
      for (const id of ["0b9f6c1e-1d2c-4f6e-9a6b-1f2e3d4c5b6a", "../x", "a b"]) {
        expect(gateMarkerFile(e, id)).toBe(markerFile(recallStateDir(resolveDbPath(e), e), id));
      }
    }
  });

  it("recalls on the first prompt of a session", () => {
    expect(shouldRecall({ session_id: "s1", prompt: "hi" }, env)).toBe(true);
  });

  it("does not recall once the CLI has claimed the session", () => {
    claimSession(recallStateDir(resolveDbPath(env), env), "s1");
    expect(shouldRecall({ session_id: "s1", prompt: "hi" }, env)).toBe(false);
  });

  it("does not recall once the gate itself has marked the session", () => {
    markSession(env, "s1");
    expect(shouldRecall({ session_id: "s1", prompt: "hi" }, env)).toBe(false);
    expect(claimSession(recallStateDir(resolveDbPath(env), env), "s1")).toBe(false);
  });

  it("does not recall when disabled", () => {
    expect(shouldRecall({ session_id: "s1", prompt: "hi" }, { ...env, MEMORY_RECALL_ENABLED: "off" })).toBe(false);
  });

  it("does not recall without a session id or prompt", () => {
    expect(shouldRecall({ prompt: "hi" }, env)).toBe(false);
    expect(shouldRecall({ session_id: "s1", prompt: "   " }, env)).toBe(false);
    expect(shouldRecall(null, env)).toBe(false);
  });

  it("pins the npm package to the plugin version", () => {
    const plugin = JSON.parse(fs.readFileSync(path.join(__dirname, "../../.claude-plugin/plugin.json"), "utf8"));
    expect(recallCommand()).toEqual(["npx", ["-y", `longterm-memory-mcp@${plugin.version}`, "recall", "--hook"]]);
  });
});

describe("hookReply", () => {
  it("passes on a hook reply", () => {
    const reply = JSON.stringify({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: "x" } });
    expect(hookReply(reply)).toBe(reply);
  });

  it.each(["", "No relevant memories found.", '{"jsonrpc":"2.0","error":{"code":-32700}}'])("drops anything else: %j", (stdout) => {
    expect(hookReply(stdout)).toBe("");
  });
});
