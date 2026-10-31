import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { claimSession, markerFile } from "../../src/recall-session.js";

describe("claimSession", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "recall-session-"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("claims a session once, and refuses every later claim", () => {
    expect(claimSession(dir, "abc-123")).toBe(true);
    expect(claimSession(dir, "abc-123")).toBe(false);
    expect(claimSession(dir, "abc-123")).toBe(false);
  });

  it("claims each session separately", () => {
    expect(claimSession(dir, "one")).toBe(true);
    expect(claimSession(dir, "two")).toBe(true);
  });

  it("creates the state directory when it is missing", () => {
    const nested = path.join(dir, "a", "b");
    expect(claimSession(nested, "s")).toBe(true);
    expect(fs.existsSync(markerFile(nested, "s"))).toBe(true);
  });

  it("keeps a hostile session id inside the state directory", () => {
    expect(path.dirname(markerFile(dir, "../../etc/passwd"))).toBe(dir);
    expect(claimSession(dir, "../escape")).toBe(true);
    expect(fs.readdirSync(path.dirname(dir)).filter((n) => n.includes("escape"))).toEqual([]);
  });

  it("removes markers older than 30 days when it claims a new session", () => {
    claimSession(dir, "old");
    const old = new Date(Date.now() - 31 * 24 * 3600 * 1000);
    fs.utimesSync(markerFile(dir, "old"), old, old);
    claimSession(dir, "recent");
    claimSession(dir, "new");
    expect(fs.existsSync(markerFile(dir, "old"))).toBe(false);
    expect(fs.existsSync(markerFile(dir, "recent"))).toBe(true);
  });
});
