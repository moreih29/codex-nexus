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
