---
description: Execution — user-directed agent composition.
triggers:
  - "[run]"
---
## Role

Execution norm that Lead follows when the user invokes the `[run]` tag. Reads tasks.json, dynamically composes subagents based on the `owner` field, and drives the execute-verify-complete cycle.

## Constraints

- NEVER execute without a plan. If tasks.json is absent, invoke nx-auto-plan first to generate one, then return.
- Tasks are executed by their `owner`. Delegation to the matching subagent is the default — not Lead solo handling.
- NEVER stop while incomplete tasks remain. Continue the cycle until `nx_task_list` confirms all tasks are `completed`.
- NEVER work on main/master. Move to a branch appropriate to the task type before starting execution.

## Procedure

### Step 1: Preparation

- **Branch Guard**: if on main/master, create and switch to a branch matching the task type (prefix: `feat/`, `fix/`, `chore/`, `research/`, etc. — Lead's judgment).
- **Load tasks.json**:
  - **Exists** → read the list with `nx_task_list` and check prior decisions with `nx_plan_status`.
  - **Absent** → auto-invoke `$nx-auto-plan` to generate tasks.json. Do NOT ask the user — `[run]` implies execution intent.

### Step 2: Execute

#### Task Registration

For each task, call `update_plan([{ name: "<label>", state: "pending" }])` to register progress tracking. Keep registrations to a maximum of 10. If tasks exceed 10, group related tasks by a natural grouping unit such as `plan_issue` or target file, so that registered entries stay within 10.

#### Task Dispatch

- Execute tasks according to the `owner` field.
  - `owner: "lead"` → Lead handles directly.
  - Others → spawn the subagent matching the owner role.
- Pass the task's `context`, `approach`, and `acceptance` as the prompt to each subagent.
- **Resume decision**: for each task, query `nx_task_resume` for resume routing information and decide whether to spawn fresh or resume according to the Resume Dispatch Rule below.
- **Parallel execution**: tasks with no deps can be spawned in parallel. Serialize tasks that share overlapping target files.

#### State Transitions

- On task start, update to `in_progress` via `nx_task_update`; on completion, update to `completed`.
- When a subagent is freshly spawned, include `owner={role, agent_id: <id from spawn>, resume_tier: <ephemeral|bounded|persistent>}` in the same `nx_task_update` call so that a future `nx_task_resume` can return this id.
- At the same moment, update progress tracking with `update_plan([{ name: "<label>", state: "in_progress" }])` / `update_plan([{ name: "<label>", state: "completed" }])`. Reuse the exact label set at initial registration.

### Resume Dispatch Rule

Lead acts based on the `resume_tier` and `agent_id` values returned by `nx_task_resume`.

- `ephemeral` → spawn fresh.
- `bounded` → resume if the same owner has prior work on overlapping target files and no other agent has edited in between. The resume prompt MUST include an instruction to "re-read target files before making any modifications."
- `persistent` → resume if the same agent participated in a prior task in this run. Cross-task reuse allowed.

When resume is chosen, invoke the `resume_agent({ id: "<id>" }) then send_input({ target: "<id>", message: "<resume prompt>" })` tool with the `agent_id` returned by `nx_task_resume`. Always provide a fresh resume prompt — some harnesses (OpenCode) do not expose a path to push additional input into a running session and support resume only by injecting a new prompt into an idle session.

If `nx_task_resume` returns `agent_id: null`, or the harness can no longer locate that id, fall back to fresh spawn silently — do NOT throw an error.

### Escalation Chain

The default path is a ping-pong between Do and Check. If Check fails twice consecutively, escalate to HOW. If failure continues after HOW review, Lead escalates to the user.

Maximum path:

```
Do → Check(fail) → Do → Check(fail) → HOW(review) → Do → Check(fail) → Lead → user
```

- **Check fails once** → re-delegate to the same Do agent (resume allowed), pass failure feedback, and run Check again after correction.
- **Check fails twice consecutively** → Lead selects and spawns the HOW agent appropriate to the task domain, receives a reviewed/adjusted approach, then re-delegates to Do.
- **Check still fails after HOW review** → Lead reports to the user with diagnostic details and requests direction.

### Step 3: Verify

Check subagents verify autonomously based on each task's `acceptance` field. Detailed judgment is left to the subagent.

- **Tester** — code verification (engineer deliverables).
- **Reviewer** — document verification (writer deliverables).

Verification failures follow the Escalation Chain above.

### Step 4: Complete

Execute in order.

1. **`nx_task_close`**: archives plan+tasks to `.nexus/history.json`. `plan.json` and `tasks.json` are removed.
2. **git commit**: bundle source changes, build artifacts (`bridge/`, `scripts/`), `.nexus/history.json`, and any modified `.nexus/memory/` or `.nexus/context/` into a single commit to maintain 1:1 cycle-commit mapping. Use explicit paths instead of `git add -A`.
3. **Report**: summarize to the user — changed files, key decisions applied, and suggested next steps. Merge/push is the user's decision and outside this skill's scope.

---

## Reference Framework

| Phase | Owner | Content |
|---|---|---|
| 1. Preparation | Lead | Branch Guard, read tasks.json via `nx_task_list` / invoke nx-auto-plan if absent |
| 2. Execute | Do subagents | Spawn per owner, resume decision via `nx_task_resume`, state transitions via `nx_task_update` |
| 3. Verify | Check subagents | Tester (code) / Reviewer (document) verification against `acceptance` criteria |
| 4. Complete | Lead | `nx_task_close`, git commit, report |

---

## Structured Delegation

When Lead delegates a task to a subagent, structure the prompt in this format:

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

## State Management

`.nexus/state/tasks.json` is created by nx-plan variants (plan/auto-plan) via `nx_task_add`, and state transitions during the nx-run cycle are reflected via `nx_task_update`. Querying is handled by `nx_task_list`, and resume decisions by `nx_task_resume`. On cycle end, call `nx_task_close` to archive plan+tasks to `.nexus/history.json`.
