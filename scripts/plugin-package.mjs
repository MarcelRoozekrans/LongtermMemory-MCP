/**
 * The npm package at this plugin's version, as `longterm-memory-mcp@<version>`.
 * A bare `npx longterm-memory-mcp` reuses whatever version npx cached first and never updates;
 * an exact version gets its own npx cache entry, so a plugin update also updates what runs.
 * release-please bumps the plugin version together with package.json.
 */

import fs from "node:fs";
import { fileURLToPath } from "node:url";

export function pinnedPackage() {
  const manifest = fileURLToPath(new URL("../.claude-plugin/plugin.json", import.meta.url));
  const { version } = JSON.parse(fs.readFileSync(manifest, "utf8"));
  return `longterm-memory-mcp@${version}`;
}
