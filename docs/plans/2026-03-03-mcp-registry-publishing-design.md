# MCP Registry Publishing Design

**Date:** 2026-03-03
**Status:** Approved

## Goal

Publish `longterm-memory-mcp` to multiple MCP registries/directories for broader discoverability, beyond the existing npm and Claude Code plugin distribution channels.

## Target Registries

| Registry | Method | Automation |
|----------|--------|------------|
| Official MCP Registry | `server.json` + `mcp-publisher` CLI | GitHub Actions (OIDC) |
| Smithery.ai | `smithery.yaml` in repo root | Auto-updates via `npx @latest` |
| Glama.ai | `glama.json` + Official Registry sync | Automatic |
| PulseMCP | Official Registry sync (weekly) | Automatic |
| mcp.so | Manual GitHub issue submission | One-time manual |

**Excluded:** mcp.run (now TurboMCP) — requires WASM rewrite incompatible with sql.js, @xenova/transformers, and stdio transport.

## New Files

### `smithery.yaml` (repo root)

Smithery.ai configuration. Uses `npx @latest` so any npm publish automatically makes the new version available — no re-publishing to Smithery needed.

### `glama.json` (repo root)

Glama.ai ownership claim. Allows modifying the server listing metadata on Glama.

### `server.json` (repo root)

Official MCP Registry metadata. Version is kept in sync by semantic-release.

### `.github/workflows/publish-mcp-registry.yml`

Separate workflow triggered by GitHub `release` event (created by semantic-release). Publishes metadata to the Official MCP Registry using OIDC authentication (no extra secrets needed).

## Modified Files

### `package.json`

- Added `mcpName` field to link npm package to MCP Registry identity
- Added `server.json` to the `files` array for ownership verification

### `release.config.js`

- Added `@semantic-release/exec` plugin (before npm) to update `server.json` version
- Added `server.json` to `@semantic-release/git` assets

## Version Synchronization

The `server.json` version fields are kept in sync by `@semantic-release/exec` running before `@semantic-release/npm`, ensuring the correct version is in the npm package.

## Manual One-Time Steps (Post-Merge)

1. **Smithery.ai:** Submit repo at smithery.ai/new
2. **mcp.so:** Comment on chatmcp/mcpso#1
3. **PulseMCP:** Auto-syncs from Official MCP Registry
4. **Glama.ai:** Claim ownership on glama.ai
