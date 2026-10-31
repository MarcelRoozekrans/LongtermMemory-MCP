import fs from "fs";
import path from "path";

const MARKER_MAX_AGE_MS = 30 * 24 * 3600 * 1000;

/** The marker file for a session. The id is reduced to safe characters, so it cannot leave the directory. */
export function markerFile(stateDir: string, sessionId: string): string {
  return path.join(stateDir, sessionId.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 128));
}

/**
 * Claims the recall for a session. Returns true for the first claim and false for every later one,
 * also across processes: the marker is created atomically. Markers older than 30 days are removed.
 */
export function claimSession(stateDir: string, sessionId: string): boolean {
  fs.mkdirSync(stateDir, { recursive: true });
  try {
    fs.writeFileSync(markerFile(stateDir, sessionId), "", { flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  }
  pruneMarkers(stateDir);
  return true;
}

function pruneMarkers(stateDir: string): void {
  const cutoff = Date.now() - MARKER_MAX_AGE_MS;
  for (const name of fs.readdirSync(stateDir)) {
    const file = path.join(stateDir, name);
    try {
      if (fs.statSync(file).mtimeMs < cutoff) fs.unlinkSync(file);
    } catch {
      // Another process pruned it first.
    }
  }
}
