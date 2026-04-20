---
description: "Structured multi-perspective analysis to decompose issues, align on decisions, and produce an enriched plan before execution. Plan only — does not execute."
triggers:
  - plan
---
## Role

Facilitate structured multi-perspective analysis using subagents to decompose issues, deliberate on options, and align on decisions. Lead acts as synthesizer AND active participant — orchestrates subagent research/analysis AND contributes its own position. Does not execute — planning only. Transition to execution is the user's decision.

## Constraints

- NEVER execute — this skill is planning only; transition to execution is the user's decision
- NEVER call `nx_plan_start` before research is complete (research_summary is required)
- NEVER present multiple issues at once — one issue at a time only
- NEVER ask groundless questions — always research code/knowledge/decisions first
- NEVER use the harness's team creation primitive. Inter-agent messaging for resume is permitted ONLY for resuming completed subagents whose `resume_tier` is `persistent` or `bounded`, and ONLY within the constraints of the Resume Policy section below. Direct inter-agent communication to running teammates remains forbidden in plan sessions.
- MUST record all decisions with `[d]` tag so they are not scattered across turns
- MUST call `nx_plan_decide` when recording `[d]`
- MUST check for existing plan.json before starting a new session
- `[d]` without an active plan.json is BLOCKED — "[d]는 plan 세션 안에서만 유효합니다."
- MUST present a comparison table before asking for a decision — never present options as prose only. Format:

```
| | A: {title} | B: {title} |
|---|---|---|
| Pros | ... | ... |
| Cons | ... | ... |
| Pick | | **(Recommended)** |
```

## Guidelines

## Trigger

- Explicit tag: `[plan]` — continue existing session if plan.json exists, otherwise start new
- Additional analysis needed mid-session: spawn HOW subagents independently via the harness's subagent spawn primitive
- Continuing conversation without a tag → continue existing session

---

## Auto Mode (`[plan:auto]`)

When triggered with `[plan:auto]` or invoked via `$nx-plan`, run the full planning process **without user interaction**:

1. **Research** — spawn researcher+Explore subagents (same as interactive)
2. **Issue derivation** — Lead identifies issues from research
3. **Auto-decide** — for each issue, Lead selects the recommended option without presenting choices. Each `nx_plan_decide(summary)` MUST include: selected approach + reason, AND rejected alternatives + why they were dismissed. No comparison table needed, but internal deliberation is mandatory.
4. **Decision briefing** — output a concise summary of all decisions before generating tasks:
   ```
   [auto-plan complete] N issues, N decisions:
   - #1: {selected} ({rejected alternative} — reason)
   - #2: ...
   ```
   Do not wait for user response — proceed immediately to task generation.
5. **Plan document** — generate tasks.json following Step 7 rules (including HOW-assisted decomposition if `how_agents` present in plan.json issues). Apply owner table and verification auto-pairing.

Key differences from interactive mode:
- No user prompts or comparison tables — Lead decides autonomously
- No dynamic agenda proposals — Lead handles all derived issues internally
- Output: tasks.json ready for `[run]` execution

**Scope by invocation context:**
- `[plan:auto]` standalone → auto-plan + briefing + tasks.json generation. Stops here.
- Invoked by `[run]` (tasks.json absent) → auto-plan + briefing + tasks.json generation + seamless execution transition. No pause between plan and run.

This mode is invoked internally by `[run]` when no tasks.json exists, or explicitly by the user with `[plan:auto]`.

---

## Procedure (Interactive Mode)

### Step 1: Intent Discovery

Determine planning depth and identify which HOW subagents to delegate analysis to, based on Progressive Depth.

| Level | Signal | Exploration Scope |
|-------|--------|-------------------|
| **Specific** | File path, function name, error message, or concrete target named | Focused on the relevant file/module |
| **Direction-setting** | Open-ended question, "it would be nice if ~", choice needed among approaches | Related area + external case research |
| **Abstract** | "I don't know how to approach this", goal itself unclear, fundamental direction | Full codebase + external research + comparable project comparison |

- Specific request → confirm intent with 1–2 questions, derive issues immediately
- Direction-setting → use hypothesis-based questions to understand intent
- Abstract/fundamental → actively interview to uncover root goals the user hasn't clarified

**HOW subagent selection rule:**
- User explicitly names agents → use as-is, propose additions if gaps detected
- User does not name agents → Lead proposes based on issue scope, confirm with user
- Additional HOW subagents can be spawned at any time during analysis (Lead's or user's discretion)

### Step 2: Research

Understand code, core knowledge, and prior decisions before forming a planning agenda.

**Start by checking existing knowledge**: before spawning any subagent, use file pattern search and file reading to scan `.nexus/memory/` and `.nexus/context/` for relevant memos and context files, and use `nx_history_search` to check for prior decisions on this topic. If the needed information is already there, use it directly and skip or narrow the subagent spawn. Only spawn subagents to fill gaps not covered by existing knowledge.

**Approach selection:**

| Scenario | Approach |
|----------|----------|
| Codebase orientation | `spawn_agent("explore", "<file/code search task>")` for codebase exploration |
| External research needed | `spawn_agent("researcher", "<research question>")` for web search |
| Both codebase and external | Spawn Explore + Researcher in parallel |

- NEVER call `nx_plan_start` before research is complete.
- `research_summary` parameter in `nx_plan_start` is required — forces research completion before session creation.
- Researcher subagents are spawned via the harness's subagent spawn primitive and return findings to Lead. They do not join the plan session.

**Existing session (plan.json present):**
- Check current state with `nx_plan_status`.
- If new topic or additional research needed → spawn researcher subagent accordingly.
- Do not proceed to next issue before research is complete.

### Step 3: Session Setup

Register the planning session.

1. **`nx_plan_start(topic, issues, research_summary)`** — register plan in plan.json; auto-archives any existing plan.json.
2. Show the issue list to the user and confirm before proceeding.

### Step 4: Analysis

**Always proceed one issue at a time.** Never present multiple issues simultaneously.

For each issue:

1. **Current State Analysis** — Lead summarizes the current state and problems, drawing on research.
2. **Subagent Analysis** — for complex issues, spawn HOW subagents (architect, strategist, etc.) in parallel via the harness's subagent spawn primitive. Each subagent independently analyzes the issue and returns findings.
   - **Domain-Agent mapping** — match issue keywords to recommended HOW subagents:

   | Domain keywords | Recommended HOW |
   |----------------|-----------------|
   | UI, UX, 디자인, 인터페이스, 사용자 경험, 레이아웃 | Designer |
   | 아키텍처, 시스템 설계, 성능, 구조 변경, API, 스키마 | Architect |
   | 비즈니스, 시장, 전략, 포지셔닝, 경쟁, 수익 | Strategist |
   | 연구 방법론, 근거 평가, 문헌, 실험 설계 | Postdoc |

   - **Opt-out default**: if the issue matches a domain in the mapping, spawning is the default. Multiple matches → multiple spawns. To skip, state "{Agent} not needed — reason: ..." in the analysis text.
   - **No mapping match**: if no domain matches, Lead analyzes directly. When uncertain, spawn — the cost of an unnecessary spawn is lower than the cost of a shallow analysis.
   - **Record HOW findings**: after HOW subagents return, include their agent names and key findings when recording the decision via `nx_plan_decide(how_agents=[...], how_summary={...})`. This data is stored in plan.json for Step 7 task generation.
3. **Present Options** — after synthesis, Lead presents a comparison:

```
| Item | A: {title} | B: {title} | C: {title} |
|------|-----------|-----------|-----------|
| Pros | ... | ... | ... |
| Cons | ... | ... | ... |
| Trade-offs | ... | ... | ... |
| Best for | ... | ... | ... |

**Recommendation: {X} ({title})**

- Option A falls short because {reason}
- Option B falls short because {reason}
- Option X overcomes {A/B limitations} → {core benefit}
```

4. **Await user response** — receive free-form responses. Users may combine options, push back, or ask follow-up questions.

## Resume Policy

When the harness's resume mechanism is unavailable, ALL resume paths are disabled — force fresh spawn. Otherwise:

| resume_tier | Same-issue default | Cross-issue | Disqualifiers |
|---|---|---|---|
| persistent | resume by default | Lead opt-in only | counter-evidence / reversal / re-review issue → fresh |
| bounded | conditional (same artifact only) | forbidden | loop 3x / feedback cycle (REVISION_REQUIRED) → fresh |
| ephemeral | forbidden | forbidden | N/A (always fresh) |

Before resuming a `bounded` agent: include a "re-read target files before any modification" instruction in the prompt. Bounded resume without re-read is BLOCKED.

`resume_tier` is read from each agent's frontmatter (`agents/*.md`). If absent, treat as `ephemeral` (most conservative).

### Step 5: Record Decision

When the user decides, record with the `[d]` tag.

- gate.ts detects `[d]` and routes to `nx_plan_decide`.
- `nx_plan_decide(issue_id, summary)` — marks issue as `decided`, writes `decision` inline in plan.json.
- Decisions are NOT written to decisions.json — plan.json is the single source of truth.
- `[d]` without plan.json is blocked.
- **Progress anchoring**: immediately after recording, output one line: "Issue #N decided (M of K complete). Next: #X — {title}." This keeps the user oriented in multi-issue sessions.

**Immediately after each decision**, Lead checks: "Does this decision create follow-up questions or new issues?" If yes, propose adding via `nx_plan_update(action='add')` before moving to the next issue.

**Decision reversal**: if the user wants to reconsider a prior decision ("아까 결정 다시 생각해보자", "issue #N 번복"), Lead calls `nx_plan_update(action='reopen', issue_id=N)` to reopen the issue and returns to Step 4 analysis for that issue.

### Step 6: Dynamic Agenda + Wrap-up

After each decision, Lead automatically checks for derived issues.

- **Dynamic agenda proposal**: after a decision is recorded, Lead examines whether the decision implies follow-on questions or unresolved sub-issues. If found, propose adding them with `nx_plan_update(action='add', ...)` and confirm with the user before adding.
- Pending issues remain → naturally transition to the next issue.
- All issues decided → **Gap check**: compare original question/topic against the issue list.
  - Gap found → register additional issues with `nx_plan_update(action='add', ...)`, return to Step 4.
  - No gap → signal planning complete.
- Wrap-up: confirm all analysis threads have reported conclusions to Lead.
- Proceed to Step 7 automatically — do not ask whether to generate the plan document.

### Step 7: Plan Document Generation

All issues decided → generate the plan document (tasks.json) immediately:

1. **Collect decisions** — gather all `decided` issues from plan.json
2. **Derive tasks** — decompose decisions into concrete, actionable tasks

   **HOW-assisted task decomposition**: check plan.json issues for `how_agents` field.
   - If HOW agents participated in analysis → re-spawn those HOWs with the decided approach + their prior `how_summary` as context. Ask them to propose task decomposition and owner assignment for their domain.
   - If no HOW agents participated → Lead decomposes alone using the owner table and auto-pairing rules above.
   - This ensures task generation depth is proportional to plan analysis depth.

3. **Enrich each task** with:
   - `approach` — implementation strategy derived from the decision rationale
   - `acceptance` — definition of done, verifiable criteria
   - `risk` — known risks or caveats from the analysis
   - `deps` — task dependencies based on execution order
   - `owner` — assign based on delegation analysis:

   | Work type | owner | Criteria |
   |-----------|-------|----------|
   | Single file, small change | **lead** | Subagent overhead > task effort |
   | Code implementation (.ts, .js, .py, etc.) | **engineer** | Source code creation/modification |
   | Documentation/content (.md, non-code) | **writer** | .md files, README, docs, non-code content |
   | Web research / external investigation | **researcher** | External information gathering needed |
   | Design analysis / review | **architect** etc. HOW | Technical trade-off judgment |
   | Sequential edits to same file | **lead** | Parallel subagents risk conflict |

   **Primary metric — artifact-coherence**: a well-scoped task targets a single artifact or a tightly coupled artifact cluster and makes a single coherent change. A change is coherent when (a) it can be described in one sentence, (b) reverting it leaves all other artifacts consistent, and (c) its acceptance can be verified by inspecting its outputs alone.

   **Verification auto-pairing (conditional)** — create a CHECK task only when the DO task's acceptance includes the appropriate verification trigger:
   - `owner: "engineer"` + acceptance contains a runtime-behavior criterion → pair a **tester** task.
   - `owner: "writer"` + acceptance contains a verifiable deliverable criterion → pair a **reviewer** task.
   - Exclusions: pure refactor (behavior-preserving), type-only changes, docs-adjacent tasks (.md or frontmatter-only, classified under `docs_only` entries in `vocabulary/task-exceptions.yml`), and researcher tasks. Researcher tasks never receive an auto-paired CHECK — research outputs feed Lead or HOW agents directly, not tester or reviewer.
   - Paired verification tasks are linked via `deps` to the original task.

   **Exception catalog**: task decomposition exceptions are defined in `vocabulary/task-exceptions.yml` (`docs_only.coherent`, `docs_only.independent`, `same_file_bundle`, `generated_artifacts`). When an exception applies to a task, record its id in the task's `context` field so downstream tooling can trace the classification.

   **Dedup Layer 1 (plan-time static merge)**: before finalizing the task list, scan draft tasks for overlapping target_files. Overlapping tasks are merged into a single owner task via the `same_file_bundle` exception from `vocabulary/task-exceptions.yml` to prevent parallel write conflicts during execution.

   **DO/CHECK decomposition principle**: DO agents (engineer, writer, researcher) and CHECK agents (tester, reviewer) accumulate less per-task context than HOW agents. When a task involves multiple independent artifacts, decompose across multiple parallel DO/CHECK subagents rather than bundling. HOW agents benefit from consolidated context and should generally remain as single sessions. Parallel decomposition is worthwhile when there are at least three independent artifacts; below that, bundling under one owner is preferable to avoid parallelization overhead.

   **HOW decomposition rule**: split HOW analysis across multiple subagents only when the issue crosses different rows of the domain-agent mapping table (architect vs designer vs strategist vs postdoc). Sub-concerns within a single domain row belong in one HOW session.

4. **Populate tasks.json** via `nx_task_add`:
   - Set `goal` from the plan topic
   - Set `decisions` from plan.json decided summaries
   - Call `nx_task_add(plan_issue=N, approach, acceptance, risk, owner)` for each task
   - If any decisions involve design or architecture changes, include a task (owner: `writer` or `lead`) to update the relevant files in `.nexus/context/` to reflect those decisions
5. **Present plan document** — show the user the generated tasks.json summary for review
6. **Present transition**: "Proceed with `[run]` to execute."

**Incremental mode**: if tasks.json already exists (e.g., after adding follow-up issues), only add tasks for new decisions. Check `plan_issue` field to avoid duplicating tasks for already-covered issues.

---

## plan → run Transition

tasks.json is already generated in Step 7. Plan's role ends here.
Proceed with `[run]` to execute.

---

## Principles

1. **Active intent discovery** — actively uncover what the user hasn't clarified. Use interviewing to surface the root goal behind the words.
2. **Lead as synthesizer AND participant** — Lead does not merely relay subagent findings. Lead forms its own position, makes recommendations, and pushes back with evidence. Not a yes-man.
3. **Exploration first + proactive expansion** — research code/knowledge/external sources before planning starts. Never ask groundless questions.
4. **Hypothesis-based questions** — instead of empty questions, form hypotheses grounded in research and confirm with the user.
5. **Progressive Depth** — automatically adjust planning depth and HOW subagent composition based on request complexity.
6. **One at a time** — never present multiple issues at once. Reduce the user's cognitive load.
7. **Options must include pros/cons/trade-offs/recommendation** — when recommending, explain why other options fall short.
8. **Objective pushback** — even when the user arrives with strong conviction, Lead MUST independently analyze all viable options and present trade-offs the user may not have considered. The comparison table exists to surface what the user doesn't know, not to confirm what they already believe. Counter with evidence when better alternatives exist.
9. **Prose conversation by default** — free-form user responses (combinations, pushback, follow-up questions) are the core of planning quality.
10. **Dynamic agenda** — decisions create new questions. Lead proactively surfaces derived issues rather than waiting for the user to notice gaps.

---

## State Management

### plan.json

`.nexus/state/plan.json` — managed via MCP tools.

```json
{
  "id": 1,
  "topic": "topic name",
  "issues": [
    {
      "id": 1,
      "title": "issue title",
      "status": "pending"
    },
    {
      "id": 2,
      "title": "issue title",
      "status": "decided",
      "decision": "decision summary",
      "how_agents": ["architect", "designer"],
      "how_summary": {
        "architect": "key findings...",
        "designer": "key findings..."
      }
    }
  ],
  "research_summary": "...",
  "created_at": "2026-01-01T00:00:00Z"
}
```

- **Create**: `nx_plan_start(topic, issues, research_summary)` — called in Step 3; auto-archives any existing plan.json
- **Status**: `nx_plan_status()` — check current issue state + decisions
- **Update**: `nx_plan_update(action, ...)` — add/remove/modify/reopen issues
- **Decide**: `nx_plan_decide(issue_id, summary)` — marks issue as `decided`, writes decision inline
- **File presence = session in progress**

### Topic Switching

- `[plan]` → continue existing plan.json if present; start new session if not
- Continue conversation without tag → continue existing session
- New `nx_plan_start` call → auto-archives current plan.json before creating new one

### Session Abort

To abort a session, archive current state via `nx_task_close`. Incomplete issues/tasks are recorded in history.json for future reference.

---

## Self-Reinforcing Loop

```
[plan] start → check/continue existing plan.json (start new if none)
  ↓
Intent discovery → research (parallel subagents) → nx_plan_start (register issues)
  ↓
Per-issue: HOW subagent analysis (parallel, independent) → Lead synthesis
  → options comparison → [d] → nx_plan_decide
  → dynamic agenda check → propose derived issues if found
  ↓
Next issue → ... → gap check → planning complete
  ↓
Proceed with `[run]` to execute.
  ↓
[run]: execution skill handles the full pipeline
  ↓
All done → nx_task_close (handled by run skill)
```

gate.ts detects `[d]` and routes to `nx_plan_decide` if plan.json exists; blocks otherwise.

## Deactivation

When transitioning to `[run]`, Plan's role ends. Execution is handled by the run skill.
