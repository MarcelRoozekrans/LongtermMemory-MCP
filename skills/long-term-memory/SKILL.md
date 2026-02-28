---
name: long-term-memory
description: Use when starting any session, after completing debugging sessions, after brainstorming or planning, after code reviews, or after any major task completion
---

# Long-Term Memory

Read `INSTRUCTIONS.md` in the repository root for the full reference (tools, text format, save parameters, structured search, graceful degradation, common mistakes).

This file covers **Claude Code-specific** behavior only.

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

## SAVE Mode (After Skill Completions)

**Invocation:** After completing any skill listed in "When to Use", self-invoke SAVE mode before responding to the user's next message. Do not wait for explicit request.

When invoked after a skill completes:

1. **Identify the completed skill** and extract key insights using the mapping table below
2. **Deduplicate** — Call `search_memory` with the insight text. If a result covers the same core fact, use `update_memory` to revise it in place (preferred), or `delete_memory` + `save_memory` if the content is completely different
3. **Persist** — Call `save_memory` (see `INSTRUCTIONS.md` for text format and save parameters)

### Skill-to-Category Mapping

| Completed Skill | Category prefix | What to Extract |
|---|---|---|
| systematic-debugging | root-cause | Root cause identified, fix applied, symptoms that led to it |
| brainstorming | design-decision | Architecture choices, rejected alternatives and why |
| writing-plans | implementation-plan | Tech approach, key libraries chosen, structural decisions |
| requesting-code-review | review-feedback | Review findings, patterns to watch for |
| receiving-code-review | code-style | User's style preferences expressed through feedback |
| test-driven-development | test-pattern | Testing strategies, test infrastructure choices |
| Any skill (no specific row above) | preference | Workflow preferences, tool preferences, communication style |
