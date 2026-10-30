import { describe, it, expect } from "vitest";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
// Plain JavaScript modules that ship with the plugin, without type declarations.
// @ts-expect-error no declarations
import { pinnedPackage } from "../../scripts/plugin-package.mjs";
// @ts-expect-error no declarations
import { launch, serverCommand } from "../../scripts/launch-server.mjs";

const root = path.join(__dirname, "../..");
const plugin = JSON.parse(fs.readFileSync(path.join(root, ".claude-plugin/plugin.json"), "utf8"));

describe("pinned npm package", () => {
  it("is the npm package at the plugin version", () => {
    expect(pinnedPackage()).toBe(`longterm-memory-mcp@${plugin.version}`);
  });

  it("matches the package.json version, which release-please bumps together with the plugin", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    expect(plugin.version).toBe(pkg.version);
  });
});

describe("plugin MCP server", () => {
  it("starts through the launcher, so the server version is pinned", () => {
    expect(plugin.mcpServers).toEqual({
      "longterm-memory": { command: "node", args: ["${CLAUDE_PLUGIN_ROOT}/scripts/launch-server.mjs"] },
    });
  });

  it("launches the pinned package with npx", () => {
    expect(serverCommand()).toEqual(["npx", ["-y", pinnedPackage()]]);
  });
});

describe("launch", () => {
  const node = process.execPath;

  it("passes stdin and stdout through and exits with the server's exit code", async () => {
    const script = "process.stdin.on('data', d => process.stdout.write('echo:' + d)); process.stdin.on('end', () => process.exit(3));";
    const launcher = spawn(node, ["-e", `import(${JSON.stringify(path.join(root, "scripts/launch-server.mjs").replace(/\\/g, "/"))}).then(m => m.launch(${JSON.stringify(node)}, ["-e", ${JSON.stringify(script)}]))`]);
    let out = "";
    launcher.stdout.on("data", (d) => (out += d));
    launcher.stdin.end("ping");
    const code = await new Promise((resolve) => launcher.on("close", resolve));
    expect(out).toBe("echo:ping");
    expect(code).toBe(3);
  });

  it.skipIf(process.platform === "win32")("forwards SIGTERM to the server, so no server is left running", async () => {
    const script = "process.on('SIGTERM', () => { process.stdout.write('got SIGTERM'); process.exit(0); }); setInterval(() => {}, 1000); process.stdout.write('ready');";
    const launcher = spawn(node, ["-e", `import(${JSON.stringify(path.join(root, "scripts/launch-server.mjs"))}).then(m => m.launch(${JSON.stringify(node)}, ["-e", ${JSON.stringify(script)}]))`]);
    let out = "";
    await new Promise<void>((resolve) => launcher.stdout.on("data", (d) => ((out += d), out.includes("ready") && resolve())));
    launcher.kill("SIGTERM");
    await new Promise((resolve) => launcher.on("close", resolve));
    expect(out).toContain("got SIGTERM");
  });
});
