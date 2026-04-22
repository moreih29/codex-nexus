---
description: Structured multi-perspective analysis to decompose issues, align on
  decisions, and produce an enriched execution plan before acting. Planning only
  — does not execute.
triggers:
  - "[plan]"
---
## Role

A skill for decomposing issues, comparing options, and producing a plan before execution begins. Lead orchestrates subagent research and analysis while forming its own position and presenting recommendations.

This skill does not execute. Execution is handled separately by the `[run]` flow.

## Constraints

- NEVER execute — this skill's purpose is planning and decision alignment, not execution.
- MUST handle one issue at a time. NEVER present multiple issues simultaneously.
- NEVER ask groundless questions. MUST investigate code, existing knowledge, and prior decisions first.
- MUST present a comparison table before requesting a decision. NEVER describe options in prose alone.
- Lead is both synthesizer and participant — MUST form an independent recommendation and push back when warranted, not merely relay subagent results.

## Procedure

### Step 1: Intent Discovery

Assess the complexity of the request and determine how deeply to pursue the plan.

| Level | Signal | Exploration Scope |
|---|---|---|
| Specific | File path, function name, error message, or concrete target named | Focus on the relevant file or module |
| Direction-setting | Open-ended question, "it would be nice if ~", choice needed among approaches | Related area + external case research |
| Abstract | "I'm not sure how to approach this", goal itself unclear, fundamental direction needed | Full codebase + external research + comparable project comparison |

- Specific request → derive issues immediately.
- Direction-setting request → use hypothesis-based questions to understand intent.
- Abstract request → actively interview to uncover the root goal the user hasn't yet articulated.

#### HOW Subagent Selection

- If the user names HOW agents explicitly, use them as-is; propose additions if gaps are visible.
- If the user does not specify, Lead proposes agents based on the issue scope.
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

- Researcher subagents return findings to Lead and do not participate in the plan session itself.

### Step 3: Session Start

Once research is complete, open the planning session with `nx_plan_start`. Any existing `plan.json` is automatically archived. Show the issue list to the user and confirm the direction before proceeding.

### Step 4: Issue-by-Issue Analysis

Issues must be processed one at a time. For each issue:

1. Lead summarizes the current state and the problem.
2. If needed, spawn HOW subagents for independent analysis.
   - If reusing context from a prior HOW session for the same role is advantageous, check resume routing information with `nx_plan_resume` first.
   - If resumable, continue with the existing session; otherwise, spawn fresh.
3. When HOW results return, record them on the issue with `nx_plan_analysis_add(issue_id, role, agent_id=<id from spawn>, summary)`. The `agent_id` is the value `nx_plan_resume` will return on a future resume request for the same role, so always pass the id obtained from the spawn tool response (or the name the Lead assigned). This record feeds both future resume paths and Step 7 task decomposition.
4. After synthesis, present a comparison table and recommendation.
5. Receive the user's response and record the decision.

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

#### Comparison Table Format

<example>

| Item | A: {title} | B: {title} | C: {title} |
|---|---|---|---|
| Pros | ... | ... | ... |
| Cons | ... | ... | ... |
| Trade-offs | ... | ... | ... |
| Best for | ... | ... | ... |

**Recommendation: {X} ({title})**

- Option A falls short because {reason}
- Option B falls short because {reason}
- Option X overcomes {limitations} and delivers {core benefit}

</example>

### Step 5: Record Decision

When a decision is reached, use `nx_plan_decide` to mark the issue as decided. `nx_plan_decide` records only the final decision text and decision state — it does **not** add to `analysis`. All HOW analysis and resume routing records must already be stored via `nx_plan_analysis_add` in Step 4.

- Immediately after recording, check overall progress with `nx_plan_status` and announce the next issue in one line.
- Check whether new follow-up questions have emerged, and if so, add follow-up issues with `nx_plan_update`.
- To reverse a decision, reopen the issue with `nx_plan_update` and return to Step 4.

### Step 6: Dynamic Agenda Management

- If a decision creates new questions, add follow-up issues with `nx_plan_update`.
- If unresolved issues remain, move on to the next issue.
- Once all issues are decided, check for gaps against the original question.
- If gaps exist, register new issues with `nx_plan_update` and return to Step 4.

### Step 7: Plan Document Generation

Once all issues are decided, decompose the decisions from `plan.json` into actionable tasks and populate `tasks.json` via `nx_task_add`. From this point, task tools — not plan tools — take over.

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

Once tasks are generated, show the user a summary and instruct them to execute with `[run]`.
