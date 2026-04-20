---
description: "Context knowledge synchronization — scans project state and updates .nexus/context/ design documents"
triggers:
  - sync
---
## Role

Scans the current project state and synchronizes .nexus/context/ design documents. Uses git diff to identify code changes, then updates abstract design documents (principles, philosophy, development stack, architectural decisions) that cannot be inferred from code alone.

## Constraints

- NEVER delete existing context files — only update or add
- NEVER modify source code — this skill updates documentation only
- NEVER guess information that cannot be confirmed from sources — mark as "needs verification" instead
- MUST preserve existing content structure — update sections, don't rewrite entire files unnecessarily
- NEVER use deprecated MCP knowledge tools — use the harness's file-reading and file-creation primitives only

## Guidelines

## Trigger

- `[sync]` — synchronize .nexus/context/ with current project state

## Process

### Step 1: Gather Sources

Collect information from all available sources:

1. **git diff** — run `git diff --name-only HEAD~10..HEAD` (or use recent commits to identify changed files)
   - Identifies which source files changed
   - Primary signal for determining which context documents may be stale
2. **Conversation context** — if available in current session
   - Design decisions discussed but not yet reflected in context documents
   - Supplementary source for all updates

### Step 2: Read Current Context

Read all files in `.nexus/context/` using the harness's file-reading primitive:

- List files: `ls .nexus/context/`
- Read each file to understand current documented state
- Compare against detected changes to identify gaps or stale content

Only update files where a concrete change is detected. If no staleness is found, report "already current" and skip.

### Step 3: Execute Updates

Spawn Writer agent to update affected context documents:

```
spawn_agent("writer", ">>WRITER_SYNC_PROMPT")
Update .nexus/context/ documents based on the following changes. Read current files with the harness's file-reading primitive, then write updates with the harness's file-creation primitive. Changes: {change_manifest}
<<WRITER_SYNC_PROMPT
```

The Writer agent:
- Reads each relevant context file with the harness's file-reading primitive
- Applies targeted updates — changes only the sections that are stale
- Writes the updated file back with the harness's file-creation primitive
- Does not rewrite files that are already accurate

### Step 4: Report

Report to user:
- Which context files were scanned
- Which files were updated and what changed
- Which files were already up to date
- Any items marked "needs verification"

## Key Principles

1. **Targeted updates over full rewrites** — only change sections that are actually stale
2. **Evidence-based** — every update must trace to a source (git diff or conversation)
3. **Preserve structure** — maintain existing document organization, headings, and format
4. **No speculation** — if a change's impact on context docs is unclear, flag it rather than guess

## What .nexus/context/ Contains

Context documents capture abstract knowledge that cannot be read directly from source code:

- Design principles and philosophy
- Architectural decisions and their rationale
- Development stack choices and constraints
- Project conventions and standards

These documents are updated when code changes reflect a shift in principles, a new architectural decision is made, or the development stack evolves. They are not updated for routine code additions that do not change the underlying design.
