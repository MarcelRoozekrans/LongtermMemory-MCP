#!/usr/bin/env node
/**
 * Starts the MCP server for the longterm-memory plugin: `npx -y longterm-memory-mcp@<plugin version>`.
 * Plain Node, no dependencies. stdio is passed through, signals are forwarded, and the exit code is the server's.
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { pinnedPackage } from "./plugin-package.mjs";

export function serverCommand() {
  return ["npx", ["-y", pinnedPackage()]];
}

export function launch(command, args) {
  // On Windows `npx` is a .cmd shim that only runs through a shell; an absolute path to an executable needs none.
  const shell = process.platform === "win32" && !path.isAbsolute(command);
  const child = spawn(command, args, { stdio: "inherit", shell });
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.on(signal, () => child.kill(signal));
  }
  child.on("error", (error) => {
    process.stderr.write(`longterm-memory: could not start the MCP server: ${error.message}\n`);
    process.exit(1);
  });
  child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
  return child;
}

// Node resolves symlinks for the main module, so compare against the real path.
if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  launch(...serverCommand());
}
