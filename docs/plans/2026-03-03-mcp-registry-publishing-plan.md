# MCP Registry Publishing Implementation Plan

**Goal:** Publish longterm-memory-mcp to multiple MCP registries for broader discoverability.

**Architecture:** Static config files for each registry, semantic-release version sync, GitHub Actions OIDC-based publish workflow.

## Tasks

1. Create `smithery.yaml` — Smithery.ai stdio config with `npx @latest`
2. Create `glama.json` — Glama.ai ownership claim
3. Create `server.json` — Official MCP Registry metadata
4. Update `package.json` — Add `mcpName` field and `server.json` to `files`
5. Configure semantic-release — Add `@semantic-release/exec` before npm to sync `server.json` version
6. Create `.github/workflows/publish-mcp-registry.yml` — OIDC-based publish on release event
7. Verify — JSON validation, build, tests

## Post-Merge Manual Steps

1. Register on Smithery.ai
2. Submit to mcp.so
3. PulseMCP auto-syncs from Official Registry
4. Claim ownership on Glama.ai
