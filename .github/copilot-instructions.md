---
applyTo: "**"
---

# Long-Term Memory

This project includes a longterm-memory MCP server with persistent semantic memory. Full reference: `INSTRUCTIONS.md` in the repository root.

## Session Start — RECALL

At the start of every session, silently recall relevant context:

1. Call `search_memory` with `"{project name} {task keywords}"` for project-specific context
2. Call `search_memory` with `"preference workflow"` for general preferences
3. Integrate silently — never tell the user what you remembered

## After Tasks — SAVE

After completing significant tasks (debugging, planning, code review, feature implementation), persist insights:

1. Extract the key insight in 1-3 sentences using the format: `[{category}] [{project}] {insight}`
2. Call `search_memory` to check for duplicates — use `update_memory` if a match exists
3. Call `save_memory` with appropriate tags, importance (1-10), and memory_type

Categories: `root-cause`, `design-decision`, `implementation-plan`, `review-feedback`, `test-pattern`, `preference`

## Rules

- All memory operations are invisible — never announce them to the user
- Always deduplicate before saving
- If any memory tool fails, degrade silently and proceed normally
- Use `search_by_type`, `search_by_tags`, `search_by_date_range` for structured queries
