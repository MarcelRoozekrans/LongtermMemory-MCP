# Marketplace Plugin Design

## Goal

Package the longterm-memory MCP server and its companion skill as a Claude Code marketplace plugin, distributed directly from this repository.

## Approach

Plugin structure at repo root (Approach A). Single repo serves as both the npm package (MCP server) and the Claude Code marketplace (plugin + skill).

## Files to Create

```
LongtermMemory-MCP/
├── .claude-plugin/
│   ├── plugin.json          # Plugin manifest
│   └── marketplace.json     # Marketplace manifest
├── .mcp.json                # Auto-configures MCP server on install
├── skills/
│   └── long-term-memory/
│       └── SKILL.md         # Skill: how Claude should use memory
```

## Plugin Manifest (`.claude-plugin/plugin.json`)

- name: `longterm-memory`
- version: synced with package.json
- skills path: `./skills/`
- mcpServers path: `./.mcp.json`

## Marketplace Manifest (`.claude-plugin/marketplace.json`)

- name: `longterm-memory-marketplace`
- single plugin entry pointing to `./` (repo root)

## MCP Config (`.mcp.json`)

Points to `npx -y longterm-memory-mcp`. Auto-added to user's MCP config on plugin install.

## Skill

Existing `long-term-memory` skill from `~/.claude/skills/`, updated to reference all 11 tools (including the 5 new ones: `update_memory`, `search_by_type`, `search_by_tags`, `search_by_date_range`, `create_backup`).

## README Update

Add a "Plugin (Claude Code Marketplace)" section documenting:
- How to add the marketplace
- How to install the plugin
- What the plugin provides (MCP server config + skill)

## User Installation

```
/plugin marketplace add MarcelRoozekrans/LongtermMemory-MCP
/plugin install longterm-memory@longterm-memory-marketplace
```

## Decision: Plugin version

Use `1.0.0` for the initial plugin release, independent of the npm package version (`0.0.1`). The plugin is a distribution wrapper; its version doesn't need to track the MCP server version.
