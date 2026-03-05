---
name: long-term-memory
description: Use when starting any session, after completing debugging sessions, after brainstorming or planning, after code reviews, or after any major task completion
---

# Long-Term Memory

Persistent, semantic memory across sessions. Two modes: **RECALL** at session start (pull relevant context) and **SAVE** after completing tasks (persist insights). All memory operations should be invisible to the user.

## Tools Available

| Tool | Purpose |
|---|---|
| `save_memory` | Store text with auto-generated semantic embedding, tags, importance, and type |
| `search_memory` | Find relevant memories using natural language query (cosine similarity) |
| `update_memory` | Modify an existing memory (content, metadata, tags, importance, type) |
| `delete_memory` | Remove a specific memory by ID |
| `delete_all_memories` | Wipe all memories (irreversible) |
| `get_all_memories` | List all stored memories (paginated) |
| `memory_stats` | Get count and database location |
| `search_by_type` | Filter memories by category (general, fact, preference, conversation, task, ephemeral) |
| `search_by_tags` | Find memories matching any of the provided tags |
| `search_by_date_range` | Find memories created within a specific date range |
| `create_backup` | Manually trigger a database backup with JSON export |

## When to Use

- **Session start**: Always. Recall relevant memories before any work begins.
- **After systematic-debugging**: Save root causes and fix patterns.
- **After brainstorming**: Save design decisions and architecture choices.
- **After writing-plans**: Save implementation approach and tech decisions.
- **After code reviews**: Save style preferences and feedback patterns.
- **After test-driven-development**: Save test patterns and strategies.
- **After any major task**: Save workflow preferences discovered during the session.

## RECALL Mode (Session Start)

When invoked at the start of a session:

1. **Detect context** — Determine the current project from:
   - Working directory name or git remote
   - Any CLAUDE.md in the project
   - The user's first message

2. **Search memories** — Call `search_memory` with two queries (sequentially):
   - `"{project name} {task keywords from user message}"` — project-specific context
   - `"preference workflow"` — general preferences that apply everywhere

3. **Integrate silently** — Use recalled memories to inform your behavior. Do NOT tell the user "I remembered X" or "Based on previous sessions." Just know it and act on it.

### Recall Rules

- If no memories are found, proceed normally — do not mention the absence.
- Focus on the most relevant results from each search.
- Never surface raw memory content to the user.

## SAVE Mode (After Task Completions)

**Invocation:** After completing any task listed in "When to Use", self-invoke SAVE mode before responding to the user's next message. Do not wait for explicit request.

When invoked after a task completes:

1. **Identify the completed task** and extract key insights using the mapping table below
2. **Deduplicate** — Call `search_memory` with the insight text. If a result covers the same core fact, use `update_memory` to revise it in place (preferred), or `delete_memory` + `save_memory` if the content is completely different
3. **Persist** — Call `save_memory` with a structured text string

### Memory Text Format

Use a structured prefix so semantic search can match on category and project:

```
[{category}] [{project}] {concise insight in 1-3 sentences}
```

**Examples:**
- `[root-cause] [myproject] EF Core cascade delete fails silently when change tracking is disabled. Fix: explicitly load related entities before delete.`
- `[design-decision] [myproject] Catalog sync uses queue-based approach instead of direct API polling to handle rate limits.`
- `[preference] [global] User prefers guard clauses over nested if-else. Prefers invisible/automatic behavior over prompted confirmations.`

### Category Table

| Completed Task | Category prefix | What to Extract |
|---|---|---|
| Debugging / bug fix | root-cause | Root cause identified, fix applied, symptoms that led to it |
| Brainstorming / design | design-decision | Architecture choices, rejected alternatives and why |
| Planning / implementation | implementation-plan | Tech approach, key libraries chosen, structural decisions |
| Code review | review-feedback | Review findings, patterns to watch for |
| Code review feedback received | code-style | User's style preferences expressed through feedback |
| Testing | test-pattern | Testing strategies, test infrastructure choices |
| Any other task | preference | Workflow preferences, tool preferences, communication style |

### Save Parameters

When calling `save_memory`, use the structured fields to improve future retrieval:

- **tags**: Derive from the category and project (e.g. `["root-cause", "myproject", "ef-core"]`)
- **importance**: Default 5. Use 7-8 for core architectural decisions, 3-4 for minor preferences.
- **memory_type**: Map from category — `root-cause` → `fact`, `design-decision` → `fact`, `preference` → `preference`, `implementation-plan` → `task`, `test-pattern` → `fact`

### Save Rules

- **Project name**: Derive from working directory or git remote. Lowercase. Use `global` for cross-project preferences.
- **Content**: 1-3 sentences capturing the core insight. Concise and reusable.
- **Dedup before save**: Always `search_memory` first. If same fact exists, prefer `update_memory`. If `save_memory` rejects with a duplicate content error, use the returned memory ID with `update_memory`.
- **Never save**: Session-specific temp state, file contents, secrets/credentials, speculative conclusions.

## Structured Search

Beyond semantic search, use these tools when the query is better served by structured filters:

- **`search_by_type`** — Find all memories of a specific kind (e.g. all `preference` memories)
- **`search_by_tags`** — Find memories with specific tags (e.g. `["auth", "backend"]`)
- **`search_by_date_range`** — Find recent memories or memories from a specific period
- **`update_memory`** — Revise an existing memory instead of delete + re-save

## Graceful Degradation

If any memory tool call fails or times out:
- Do not show errors to the user.
- Do not retry repeatedly.
- Proceed with the session normally as if no memory exists.
- Do not mention that memory is unavailable.

## Common Mistakes

| Mistake | Fix |
|---|---|
| Announcing "I recalled from memory..." | Integrate silently — never reveal memory operations. |
| Saving entire file contents | Save the insight, not the data. |
| Saving session-specific temp state | Only save reusable, cross-session insights. |
| Creating duplicate memories | Always search before saving; use `update_memory` for revisions. |
| Saving speculative conclusions | Only save confirmed facts and expressed preferences. |
| Showing errors when MCP is down | Degrade silently, proceed normally. |
| Using only semantic search | Use structured search (by type, tags, date) when appropriate. |
