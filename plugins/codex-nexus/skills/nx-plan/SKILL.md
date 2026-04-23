---
description: Structured multi-perspective analysis to decompose issues, align on
  decisions, and produce an enriched execution plan before acting. Planning only
  — does not execute.
triggers:
  - "[plan]"
---
## Role

A skill for decomposing issues, comparing options, and producing a plan **together with the user** before execution begins. Lead orchestrates subagent research and analysis and presents recommendations, but **decision authority always belongs to the user**.

This skill does not execute. Execution is handled separately by the `[run]` flow. When user dialogue must be skipped and Lead must decide autonomously, use `[auto-plan]` instead of this skill.

## Core Rules — Absolute Rules

The three rules below are the identity of this skill. **Violating even one makes this auto-plan, not nx-plan.**

1. **Lead NEVER decides alone.** Recommendations may be presented, but no issue moves to decided state without an explicit user response.
2. **MUST stop immediately after outputting the comparison table + recommendation.** Before receiving the user's response, do not invoke `nx_plan_decide`, `nx_plan_update`, or `nx_task_add`, and do not move to the next issue.
3. **Interpret user responses conservatively.** Silence, vague acknowledgments ("hmm", "I see"), or transitions to other topics are NOT approval. To count as approval, one of the following must occur:
   - Explicit selection of the recommendation or a specific option ("let's go with X", "option A").
   - Explicit acceptance of Lead's proposed decision statement ("OK", "sounds good", "do it that way").
   - Modification directives followed by a confirming utterance like "go with that".

If the user requests full delegation such as "you decide" or "whatever you think", do NOT proceed with this skill — **first confirm whether to switch to `[auto-plan]`**.

## Supplementary Rules

- NEVER execute — this skill's purpose is planning and decision alignment.
- MUST handle one issue at a time. NEVER present multiple issues simultaneously.
- NEVER ask groundless questions. MUST investigate code, existing knowledge, and prior decisions first.
- MUST present a comparison table when requesting a decision. NEVER describe options in prose alone.
- Lead is synthesizer and participant — form independent recommendations and push back when warranted, not merely relay subagent results. **But never take over final decision authority.**

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
   - If resumable, invoke `resume_agent({ id: "<id>" }) then send_input({ target: "<id>", message: "<resume prompt>" })` with the `agent_id` returned by `nx_plan_resume`; otherwise, spawn fresh.
3. When HOW results return, record them on the issue with `nx_plan_analysis_add(issue_id, role, agent_id=<id from spawn>, summary)`. The `agent_id` is the value `nx_plan_resume` will return on a future resume request for the same role, so always pass the agent id obtained from the spawn tool response. Do not substitute a human-readable assigned name; names are only for messaging a currently running subagent and are not a safe resume identifier for a completed session. This record feeds both future resume paths and Step 7 task decomposition.
4. After synthesis, present a comparison table and recommendation.
5. **⛔ Stop here.** Pose the question to the user and wait for the response without invoking any other tool.
   - In this turn, do NOT call `nx_plan_decide`, `nx_plan_update`, or `nx_task_add`.
   - Do not move to the next issue. Do not resume investigation (if new questions emerge, tell the user first).
   - Do not spawn additional HOW subagents (exception: the user explicitly asks "analyze more").
   - The final output MUST end with a question the user can easily choose from. Example: "Confirm recommendation X? Or prefer one of A/B/C?"
6. Proceed to Step 5 only after receiving the user response. If the response does not meet the approval conditions (Absolute Rule 3), ask again.

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

Enter this step **only when the user has explicitly selected, accepted, or confirmed**. Entering based on Lead's own judgment or user silence violates Absolute Rules 1 and 3.

When entry is justified, use `nx_plan_decide` to mark the issue as decided. `nx_plan_decide` records only the final decision text and decision state — it does **not** append to `analysis`. All HOW analysis and resume routing records must already be stored via `nx_plan_analysis_add` in Step 4.

- Immediately after recording, check overall progress with `nx_plan_status` and announce the next issue in one line.
- Check whether new follow-up questions have emerged, and if so, add follow-up issues with `nx_plan_update`.
- To reverse a decision, reopen the issue with `nx_plan_update` and return to Step 4.

#### Entry Checklist

Call `nx_plan_decide` **only when all of the following answer "yes"**:

- Did the user respond in this turn or the previous turn?
- Does that response explicitly point to the recommendation, a specific option, or Lead's proposed decision statement?
- If the user directed modifications, did Lead show the revised decision statement once more and receive a confirming response equivalent to "confirm as-is"?

If any answer is "no", return to the Step 4 stop state and re-ask the user.

### Step 6: Dynamic Agenda Management

- If a decision creates new questions, **explain the need for the follow-up issue to the user in one line and obtain consent before adding it.** Only after consent, add the follow-up issue with `nx_plan_update`.
- If unresolved issues remain, move on to the next issue.
- Once all issues are decided, check for gaps against the original question and share the check result as a summary to the user.
- If gaps exist, obtain user consent, register new issues with `nx_plan_update`, and return to Step 4.

### Step 7: Plan Document Generation

Once all issues are decided, decompose the decisions from `plan.json` into actionable tasks and populate `tasks.json` via `nx_task_add`. This is the default termination procedure of the plan skill and proceeds automatically without a separate user confirmation. From this point, task tools — not plan tools — take over.

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
