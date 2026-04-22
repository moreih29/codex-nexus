---
description: Autonomous planning skill — Lead decomposes, analyzes, and decides
  issues without user confirmation, producing an execution plan. Keeps nx-plan's
  research and analysis depth while skipping user dialogue.
triggers:
  - "[auto-plan]"
---
## Role

Performs the same research and analysis process as nx-plan, but Lead makes decisions autonomously without presenting options or waiting for user responses. HOW subagent usage, researcher/explore investigations, prior-knowledge lookup, and issue decomposition are identical to nx-plan. The only difference is at decision time — instead of emitting a comparison table and awaiting user response, Lead deliberates internally and records the decision immediately.

This skill does not execute. Execution is handled separately by the `[run]` flow. It is also the path `[run]` invokes internally when tasks.json is absent.

## Constraints

- **NEVER request user confirmation.** All decisions MUST be made by Lead autonomously and recorded directly.
- **MUST maintain the same research and analysis depth as nx-plan.** HOW subagent spawning, researcher/explore investigations, and the existing-knowledge-first principle all apply.
- **MUST record both the selected approach with rationale AND rejected alternatives with dismissal reasons in every decision.** Comparison tables are not output, but internal deliberation is mandatory.
- **MUST brief all decisions at once after completion.** NEVER notify the user per-decision.

## Procedure

### Step 1: Intent Discovery

Determine issue scope and complexity from the request itself. Do not conduct additional user interviews.

| Level | Signal | Exploration Scope |
|---|---|---|
| Specific | File path, function name, error message, or concrete target named | Focus on the relevant file or module |
| Direction-setting | Open-ended question, "it would be nice if ~", choice needed among approaches | Related area + external case research |
| Abstract | Goal itself unclear, fundamental direction needed | Full codebase + external research + comparable project comparison |

- Specific request → derive issues immediately.
- Direction-setting → Lead selects the most reasonable direction based on research findings.
- Abstract → broaden research scope and have Lead infer the root goal.

#### HOW Subagent Selection

- Lead autonomously selects HOW subagents matching the issue scope.
- If the user explicitly named HOW agents, use them as-is and add missing axes when visible.
- Additional HOW subagents can be spawned at any point during analysis.

### Step 2: Research

Understand code, core knowledge, and prior decisions before forming the planning agenda.

#### Existing Knowledge First

- Read `.nexus/memory/` and `.nexus/context/` first.
- Use `nx_history_search` to check whether prior decisions exist on similar topics.
- If the needed information is already available, use it directly and skip or narrow subagent spawning.

#### Approach Selection

| Situation | Approach |
|---|---|
| Codebase orientation needed | `spawn_agent("explorer", "<file/code search task>")` for codebase exploration |
| External research needed | `spawn_agent("researcher", "<research question>")` for web search |
| Both needed | Spawn `spawn_agent("explorer", "<file/code search task>")` and `spawn_agent("researcher", "<research question>")` in parallel |

- Researcher subagents return findings to Lead and do not participate in the auto-plan session itself.

### Step 3: Session Start

Once research is complete, open the planning session with `nx_plan_start`. Any existing `plan.json` is automatically archived. Unlike nx-plan, the issue list is NOT presented to the user beforehand — proceed directly to Step 4.

### Step 4: Issue-by-Issue Analysis

Issues must be processed one at a time. For each issue:

1. Lead summarizes the current state and the problem.
2. If needed, spawn HOW subagents for independent analysis.
   - If reusing context from a prior HOW session for the same role is advantageous, check resume routing information with `nx_plan_resume` first.
   - If resumable, continue with the existing session; otherwise, spawn fresh.
3. When HOW results return, record them on the issue with `nx_plan_analysis_add(issue_id, role, agent_id=<id from spawn>, summary)`. The `agent_id` is the value `nx_plan_resume` will return on a future resume request for the same role, so always pass it.
4. **Lead internal deliberation**: enumerate candidate options, compare pros/cons and trade-offs, and select the most reasonable one. Do not output comparison tables or option presentations.
5. Proceed immediately to Step 5 to record the decision.

#### HOW Domain Mapping

| Domain Keywords | Recommended HOW |
|---|---|
| UI, UX, design, interface, user experience, layout | Designer |
| Architecture, system design, performance, structural change, API, schema | Architect |
| Business, market, strategy, positioning, competition, revenue | Strategist |
| Research methodology, evidence evaluation, literature, experiment design | Postdoc |

- If an issue matches a domain above, spawning the corresponding HOW is the default.
- If the issue crosses multiple domains, spawn multiple HOWs together.
- To skip spawning, state the reason explicitly in the analysis text.

### Step 5: Record Decision

Use `nx_plan_decide` to mark the issue as decided. The decision text MUST include:

- The selected approach and its rationale
- The rejected alternatives and their dismissal reasons

If HOW subagents participated in the issue, bundle their contribution information so it can be referenced in future resumes and Step 7 task decomposition.

If the decision creates follow-up questions or derived issues, add them with `nx_plan_update` and move to Step 6. Do not ask the user for confirmation.

### Step 6: Dynamic Agenda Management

- If derived issues emerge, add them via `nx_plan_update` and return to Step 4.
- If unresolved issues remain, move on to the next issue.
- Once all issues are decided, Lead checks for gaps against the original request.
- If gaps exist, register new issues with `nx_plan_update` and return to Step 4.

### Step 7: Briefing and Plan Document Generation

Once all issues are decided, brief the user in a single pass:

```
[auto-plan complete] N issues, N decisions
- #1: {selected} ({rejected alternative} — reason)
- #2: ...
```

Immediately after briefing, decompose the decisions from `plan.json` into actionable tasks and populate `tasks.json` via `nx_task_add`. From this point, task tools — not plan tools — take over.

Fill in the following fields for each task:

- `approach` — implementation strategy derived from the decision rationale
- `acceptance` — definition of done, verifiable criteria
- `risk` — risks surfaced during analysis
- `deps` — execution-order dependencies
- `owner` — assigned according to the criteria below

For issues where HOW subagents participated, reference the analysis recorded in Step 4, or re-spawn the same HOW to request domain-appropriate decomposition.

#### Owner Assignment Criteria

| Work Type | owner | Criteria |
|---|---|---|
| Single file, small change | `lead` | Subagent overhead exceeds task effort |
| Code implementation | `engineer` | Source code creation or modification |
| Documentation/content | `writer` | `.md`, README, docs, non-code content |
| External research | `researcher` | External information gathering required |
| Design analysis / review | HOW role | Technical judgment is the core work |
| Sequential edits to the same file | `lead` | High risk of parallel edit conflicts |

#### Verification Auto-Pairing

- If an `engineer` task has a runtime-behavior criterion in its acceptance, pair a `tester` task.
- If a `writer` task has a verifiable deliverable criterion in its acceptance, pair a `reviewer` task.
- Researcher tasks are not auto-paired by default.

Once tasks are generated, instruct the user to execute with `[run]`. If this skill was invoked internally by `[run]`, hand off to the run flow directly without the instruction.
