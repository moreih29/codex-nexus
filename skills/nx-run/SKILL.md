---
name: nx-run
description: Execution — user-directed agent composition.
trigger_display: "[run]"
purpose: "Execution — user-directed agent composition"
---

## Role

Execution norm that Lead follows when the user invokes the [run] tag. Composes subagents dynamically based on user direction and drives the full execution pipeline from intake to completion.

## Constraints

- NEVER modify files via shell commands (sed, echo redirection, heredoc, tee, etc.) — always use the harness's dedicated file-editing primitives (gate enforced)
- NEVER terminate while pending tasks remain (Gate Stop nonstop)
- NEVER spawn a new branch without checking for main/master first
- MUST check tasks.json before executing — if absent, generate the plan first
- MUST spawn subagents per-task based on owner field — Do not handle multi-task work as Lead solo when task count ≥ 2 or target files ≥ 2
- MUST NOT spawn parallel Engineers if their target files overlap — serialize instead
- MUST call nx_task_close before completing the cycle — archive plan+tasks to history.json

## Guidelines

## Flow

### Step 1: Intake (Lead)

- **User specifies agents/direction** → follow the instruction as given.
- **[run] only (no direction)** → confirm direction with user before proceeding.
- User decides scope and composition. Lead fills in what is not specified.
- **Branch Guard**: if on main/master, create a branch appropriate to the task type before proceeding (prefix: `feat/`, `fix/`, `chore/`, `research/`, etc. — Lead's judgment). Auto-create without user confirmation.
- Check for `tasks.json`:
  - **Exists** → read it and proceed to Step 2.
  - **Absent** → auto-invoke `Load and follow the $nx-plan skill now (mode: auto).` to generate tasks.json. Do NOT ask — `[run]` implies execution intent. After plan generation, proceed to Step 2.
- If tasks.json exists, check prior decisions with `nx_plan_status`.

### Step 1.5: TUI Progress

Register tasks for visual progress tracking (Ctrl+T):

- **≤ 10 tasks**: `Best effort only: if the runtime exposes a Codex visual progress tracker, use update_plan to keep the existing plan items in sync, setting the entry whose step is "<per-task label>" to status "pending" and appending it if missing. Do not use nx_task_add or nx_task_update for this primitive; those tools manage persistent Nexus task state rather than transient UI progress.` per task
- **> 10 tasks**: group by `plan_issue`, `Best effort only: if the runtime exposes a Codex visual progress tracker, use update_plan to keep the existing plan items in sync, setting the entry whose step is "<group label>" to status "pending" and appending it if missing. Do not use nx_task_add or nx_task_update for this primitive; those tools manage persistent Nexus task state rather than transient UI progress.` per group
- Update the registered entry via `Best effort only: if the runtime exposes a Codex visual progress tracker, use update_plan to keep the existing plan items in sync, setting the entry whose step is "<label>" to status "in_progress" and appending it if missing. Do not use nx_task_add or nx_task_update for this primitive; those tools manage persistent Nexus task state rather than transient UI progress.` / `Best effort only: if the runtime exposes a Codex visual progress tracker, use update_plan to keep the existing plan items in sync, setting the entry whose step is "<label>" to status "completed" and appending it if missing. Do not use nx_task_add or nx_task_update for this primitive; those tools manage persistent Nexus task state rather than transient UI progress.` as execution proceeds
- **Skip only if**: non-TTY environment (VSCode, headless)
- **Known issue**: TUI may freeze during auto-compact (#27919) — task data on disk remains correct

### Step 2: Execute

- **Present tasks.json** to the user — show task list with owner, deps, approach summary. Proceed immediately without asking for confirmation.
- Execute tasks based on `owner` field:
  - `owner: "lead"` → Lead handles directly
  - `owner: "engineer"`, `"researcher"`, `"writer"`, etc. → spawn subagent matching the owner role
  - `owner: "architect"`, `"tester"`, `"reviewer"`, etc. → spawn corresponding HOW/CHECK subagent
- For each subagent, pass the task's `context`, `approach`, and `acceptance` as the prompt.
- **Parallel execution**: independent tasks (no overlapping target files, no deps) can be spawned in parallel. Tasks sharing target files must be serialized.
- **SubagentStop escalation chain**: when a subagent stops with incomplete work:
  1. **Do/Check failed** → spawn the relevant HOW agent (e.g., Engineer failed → Architect) to diagnose the failure, review the approach, and suggest adjustments.
  2. **Re-delegate** → apply HOW's adjusted approach and re-delegate to a new Do/Check agent.
  3. **HOW also failed** → Lead reports the failure to the user with diagnosis details and asks for direction.
  - Maximum: 1 HOW diagnosis + 1 re-delegation per task. After that, escalate to user.
  - Relevant HOW mapping: Engineer→Architect, Writer→Strategist, Researcher→Postdoc, Tester→Architect.

### Resume Dispatch Rule

For each task, Lead chooses between fresh spawn and resume based on the `owner`'s `resume_tier`:

1. Lookup `resume_tier` from `agents/{owner}.md` frontmatter (if absent → treat as `ephemeral`).
2. If `ephemeral` → fresh spawn. Stop.
3. If `bounded` → check tasks.json history: did the same `owner` previously work on overlapping target files? If yes AND no intervening edits by other agents → resume candidate. Otherwise fresh. Always include "re-read target files before any modification" instruction in the resume prompt.
4. If `persistent` → resume by default if the same agent worked earlier in this run. Cross-task reuse allowed.
5. Before attempting any resume, verify the harness's resume mechanism is available. If unavailable, fall back to fresh spawn silently — do NOT throw an error.

### Step 3: Verify (Lead + Check subagents)

**Lead**: confirm build + E2E pass/fail.

**Tester — acceptance criteria verification**:
- Tester reads each completed task's `acceptance` field from tasks.json
- Verifies each criterion with PASS/FAIL judgment
- All criteria must pass for the task to be considered done
- If any criterion fails → Step 2 rework (reopen task)
- Tester spawn conditions (any one triggers):
  - tasks.json contains at least 1 task with an `acceptance` field
  - 3 or more files changed
  - Existing test files modified
  - External API/DB access code changed
  - Failure history for this area exists in memory

**Reviewer — writer deliverable verification**:
- Whenever Writer produced a deliverable in Step 2, Reviewer MUST verify it
- Writer → Reviewer is a mandatory pairing, not optional
- Reviewer checks: factual accuracy, source consistency, grammar/format

- If issues found: code problems → Step 2 rework; design problems → re-run nx-plan before re-executing.

### Step 4: Complete

Execute in order:

1. **nx-sync**: invoke `Load and follow the $nx-sync skill now.` if code changes were made in this cycle. Best effort — failure does not block cycle completion.
2. **nx_task_close**: call to archive plan+tasks to history.json. This updates `.nexus/history.json`.
3. **git commit**: stage and commit source changes, build artifacts (`bridge/`, `scripts/`), `.nexus/history.json`, and any modified `.nexus/memory/` or `.nexus/context/`. Use explicit `git add` with paths (not `git add -A`) and a HEREDOC commit message with `Co-Authored-By`. This ensures the cycle's history archive lands in the same commit as the code changes, giving a 1:1 cycle-commit mapping.
4. **Report**: summarize to user — changed files, key decisions applied, and suggested next steps. Merge/push is the user's decision and outside this skill's scope.

---

## Reference Framework

| Phase | Owner | Content |
|-------|-------|---------|
| 1. Intake | Lead | Clarify intent, confirm direction, Branch Guard, check tasks.json / invoke nx-plan if absent |
| 2. Execute | Do subagents | Spawn per-task by owner, delegation criteria, parallel where safe |
| 3. Verify | Lead + Check subagent | Build check, quality verification |
| 4. Complete | Lead | nx-sync, nx_task_close, git commit, report |

---

## Structured Delegation

When Lead delegates tasks to subagents, structure the prompt in this format:

```
TASK: {specific deliverable}

CONTEXT:
- Current state: {relevant code/doc locations}
- Dependencies: {results from prior tasks}
- Prior decisions: {relevant decisions}
- Target files: {file path list}

CONSTRAINTS:
- {constraint 1}
- {constraint 2}

ACCEPTANCE:
- {completion criterion 1}
- {completion criterion 2}
```

---

## Key Principles

1. **Lead = interpret user direction + coordinate + own tasks**
2. **User decides scope and composition**
3. **tasks.json is the single source of state** — produced by nx-plan, read at Step 1, updated as tasks complete
4. **Do subagents = execute per owner** — Lead spawns one subagent per task based on the `owner` field. Engineers focus on code changes. Doc updates are done in bulk by Writer in Step 4. Researcher records to reference/ immediately.
5. **Check subagents = verify** — Lead's discretion + 4 conditions
6. **SubagentStop escalation** — when a subagent stops with incomplete work, escalate through HOW diagnosis → re-delegation → user report. Max 1 cycle per task.
7. **Gate Stop nonstop** — cannot terminate while pending tasks exist
8. **Plan first** — if tasks.json is absent, nx-plan must run before Step 2
9. **No file modification via shell commands** — sed, echo redirection, heredoc, tee, and similar shell-based file edits are prohibited. Always use the harness's dedicated file-editing primitives (gate enforced)
## State Management

`.nexus/state/tasks.json` — produced by nx-plan, managed via `nx_task_add`/`nx_task_update`. Gate Stop enforcement.
On cycle end, archive plan+tasks to `.nexus/history.json` via `nx_task_close`.


---

## Harness-Specific: resume_invocation

# Codex Agent Resume Mechanism

Codex exposes native completed-agent continuation through `resume_agent(id)` and `send_input(target, ...)`.

## Native Primitives

| Tool | Purpose |
|---|---|
| `resume_agent` | Re-open a previously completed agent by its Codex agent id |
| `send_input` | Send the follow-up prompt into the resumed agent context |

When continuity is available, the default Codex pattern is:

1. `resume_agent(id=<prior agent id>)`
2. `send_input(target=<same id>, message=<follow-up prompt>)`

If the runtime rejects the resume or the prior id no longer exists, silently fall back to a fresh `spawn_agent`.

## Continuity Sources

- **Plan mode**: prefer `how_agent_ids` recorded on the relevant plan issue, then fall back to `.nexus/state/codex-nexus/agent-tracker.json`
- **Run mode**: prefer the task's persisted `owner_agent_id`, then fall back to tracker-based continuity for `persistent` tiers only

## Resume Tiers

| Tier | Codex policy |
|---|---|
| `persistent` | resume by default when a completed prior participant exists |
| `bounded` | resume only when the task is pinned to a prior `owner_agent_id`; prepend `Re-read target files before any modification.` to the follow-up prompt |
| `ephemeral` | always fresh spawn |

## Run-Mode State

For reusable run-task continuity, keep the task's `owner_agent_id` populated after the first spawn. Use `nx_task_update(id, owner_agent_id=..., status=...)` to persist it.

`nx_task_resume` returns delegation-ready guidance for run tasks, including whether to resume or spawn fresh.
