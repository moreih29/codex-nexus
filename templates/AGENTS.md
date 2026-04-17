## Nexus Agent Orchestration

**Default: DELEGATE**. Route substantial code work, analysis, and multi-file changes to specialist agents instead of handling everything solo.

Before starting work, check `.nexus/context/`, `.nexus/memory/`, and `.nexus/rules/` for project-specific knowledge.

### Core Workflow

- `[plan]` starts structured decision-making before implementation.
- `[run]` starts task-based execution.
- `[sync]` refreshes `.nexus/context/` after meaningful completed cycles.
- `[d]` records a decision against the current plan issue.
- `$nx-init` bootstraps `.nexus/` knowledge for the current repository.

### Nexus-Core Upgrade Protocol

Source of truth: `moreih29/nexus-core` `CONSUMING.md`.

When upgrading `@moreih29/nexus-core`, follow this exact order:

1. Check local `package.json` and detect the target version change.
2. Read local `node_modules/@moreih29/nexus-core/manifest.json`.
3. WebFetch `CHANGELOG.md` at the exact `vX.Y.Z` tag and scan for `nx-car` markers.
4. If the `CHANGELOG` lists one, WebFetch `MIGRATIONS/{from}_to_{to}.md` for that upgrade path.
5. WebFetch `.nexus/rules/semver-policy.md` at the exact `vX.Y.Z` tag.
6. Run `bun run validate:conformance` in the consumer repo, and extend fixture coverage if new state-schema fields were added.

### Skills

Read and follow these installed skills when routed by user intent or tags:

- `$nx-init` -> `.codex/skills/nx-init/SKILL.md`
- `$nx-plan` -> `.codex/skills/nx-plan/SKILL.md`
- `$nx-run` -> `.codex/skills/nx-run/SKILL.md`
- `$nx-sync` -> `.codex/skills/nx-sync/SKILL.md`

### Nexus MCP Tools

Use the `nx` MCP server for stateful workflows:

- `nx_context`
- `nx_plan_start`, `nx_plan_status`, `nx_plan_resume`, `nx_plan_followup`, `nx_plan_update`, `nx_plan_decide`
- `nx_task_add`, `nx_task_list`, `nx_task_update`, `nx_task_resume`, `nx_task_close`, `nx_history_search`
- `nx_artifact_write`
- `nx_init`, `nx_sync`

### Agent Routing

Use the installed native agents for specialization:

- `architect` -> technical design, interfaces, architectural trade-offs
- `designer` -> UX, UI, and interaction design
- `postdoc` -> research method design and synthesis
- `strategist` -> product and business strategy
- `engineer` -> implementation, fixes, debugging
- `researcher` -> investigation and evidence gathering
- `writer` -> documentation and written deliverables
- `reviewer` -> output review and fact checks
- `tester` -> testing and verification

### Execution Discipline

- For significant execution, create tasks with `nx_task_add` before non-trivial changes.
- Keep edits scoped to active tasks.
- Update task state as work progresses.
- When reusing a completed subagent, prefer `nx_plan_followup` or `nx_task_resume` and follow the returned Codex `resume_agent` -> `send_input` guidance.
- Verify before calling work complete.
- After a completed run cycle, use `nx_sync` when useful and archive with `nx_task_close`.
