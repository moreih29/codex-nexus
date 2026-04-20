# codex-nexus

[![npm version](https://img.shields.io/npm/v/codex-nexus)](https://www.npmjs.com/package/codex-nexus)

> 🌏 [한국어](README.md)

Nexus wrapper plugin for OpenAI Codex CLI.

`codex-nexus` uses the Codex `sync` outputs from `@moreih29/nexus-core` as its source of truth, then layers Codex-specific install, config merge, hook, and MCP adapters on top. Common Nexus definitions and generated Codex outputs come from `nexus-core`; `codex-nexus` packages and connects them for Codex CLI.

## Why

- plan before implementation with `[plan]`
- execute through task-based `[run]`
- resume completed specialist subagents through Codex-native continuation
- keep project knowledge and decisions in `.nexus/`
- use a Codex-native specialist agent catalog
- access plan/task/history/context flows through `nx` MCP tools

## Architecture

- `nexus-core` — source of truth for shared Codex assets and generated output contract
- `codex-nexus` — Codex-specific wrapper (`install`, config merge, hooks, MCP adapter)
- `bun run sync:core` — runs upstream `nexus-core sync --harness=codex` into a staging directory, then applies the managed outputs to this repo's `agents/`, `plugin/`, `prompts/`, and `install/`

## Quick Start

### 1. Install

`codex-nexus` is distributed through npm, but the installed hooks and MCP adapter execute with `bun`.

Requirements:

- OpenAI Codex CLI
- `bun` available on `PATH`

```bash
npm install -g codex-nexus
codex-nexus install
```

When `codex-nexus install` runs in a TTY, it prompts for:

- which package version to install
- which target scope to install into (`user` or `project`)

`install` copies the core-generated skills and agents into the scope-appropriate `.codex/`, then configures the Codex-adapted `nx` MCP server and default optional integrations in `.codex/config.toml`. The current default optional integration is hosted `Context7`. Export `CONTEXT7_API_KEY` in your shell if you want authenticated Context7 access and higher rate limits.

Starting with `nexus-core@0.16.0`, `.codex/agents/*.toml` uses the standalone role-file schema that current Codex loads directly. If you were installed on the older nested agent TOML format, rerun `codex-nexus install --scope user` or `codex-nexus install --scope project` after upgrading so the agent files are refreshed.

AGENTS behavior differs by scope:

- `--scope user` updates `~/.codex/AGENTS.md` and leaves the current repository's `./AGENTS.md` untouched
- `--scope project` updates the current repository's `./AGENTS.md`

To install explicitly:

```bash
codex-nexus install --scope user --version latest
codex-nexus install --scope project --version 0.2.0
```

To install only the core Nexus setup without optional MCP integrations:

```bash
codex-nexus install --core-only
```

To verify the installation:

```bash
codex-nexus doctor --scope user
codex-nexus doctor --scope project
```

### 2. Onboard Your Project

Start by running `$nx-init` in your project.

```text
$nx-init
```

This loads the onboarding workflow that scans the repository and prepares initial knowledge under `.nexus/`.

### 3. Start Using It

- Plan: `[plan] How should we design the auth flow?`
- Record a decision: `Let's go with that direction [d]`
- Run: `[run] Implement the agreed auth flow`

Typical flow:

`[plan]` to discuss and align → `[d]` to record decisions → `[run]` to execute

## Usage

| Tag | Action | Example |
|---|---|---|
| `[plan]` | pre-implementation planning mode | `[plan] Discuss DB migration strategy` |
| `[run]` | task-based execution mode | `[run] Implement login API` |
| `[d]` | record a decision for the current plan issue | `Let's go with option 2 [d]` |
| `[sync]` | sync `.nexus/context/` | `[sync] Reflect recent architecture changes into context docs` |
| `[rule]` | save a team rule | `[rule] Use bun as the default package manager` |
| `[rule:<tag>]` | save a tagged rule | `[rule:testing] Always run tests before release` |
| `[m]` | save a memo or reference | `[m] Save lessons from this incident` |
| `[m:gc]` | clean up memory entries | `[m:gc] Deduplicate memory notes` |

## Agents

The primary main-thread agent is `Lead`, and Codex AGENTS.md receives the core-generated lead fragment during install.

### How

| Agent | Role | Model |
|---|---|---|
| Architect | technical design and architecture review | `gpt-5.4` |
| Designer | UX/UI and interaction design | `gpt-5.4` |
| Postdoc | research methodology and evidence synthesis | `gpt-5.4` |
| Strategist | strategy, positioning, and business judgment | `gpt-5.4` |

### Do

| Agent | Role | Model |
|---|---|---|
| Engineer | implementation and debugging | `gpt-5.3-codex` |
| Researcher | independent investigation and web research | `gpt-5.3-codex` |
| Writer | documentation and written deliverables | `gpt-5.3-codex` |

### Check

| Agent | Role | Model |
|---|---|---|
| Tester | testing, verification, and stability checks | `gpt-5.3-codex` |
| Reviewer | document, fact, and format review | `gpt-5.3-codex` |

## Entrypoints

| Entrypoint | Purpose |
|---|---|
| `$nx-init` | project onboarding and initial `.nexus/` knowledge generation |
| `[plan]` | structured discussion and decision-making |
| `[run]` | task-based execution |
| `[sync]` | `.nexus/context/` synchronization |

## Subagent Resume

Completed subagents can be continued through Codex-native resume flow.

- plan mode: `nx_plan_resume` and `nx_plan_followup` return follow-up guidance in `resume_agent -> send_input` form
- run mode: `nx_task_resume` evaluates `owner_agent_id`, `owner_reuse_policy`, and `agent-tracker.json` to decide between resume and fresh spawn
- `persistent` tier: resume by default when a prior completed participant exists
- `bounded` tier: requires `owner_agent_id` to be persisted on the task, and prepends `Re-read target files before any modification.` to the follow-up prompt
- `ephemeral` tier: always fresh spawn

To preserve run-mode continuity, store the returned agent id on the task after the first spawn.

```text
nx_task_update(id=<task id>, owner_agent_id=<returned agent id>, status="in_progress")
```

## What Install Writes

An install updates these managed surfaces under the selected scope:

- `.codex/packages/node_modules/codex-nexus`
- `.codex/config.toml` (`nx` MCP plus hosted `context7` MCP by default)
- `.codex/hooks.json`
- `.codex/skills/*` (copied from `plugin/skills/`)
- `.codex/agents/*.toml` (standalone Codex role files generated from `nexus-core` assets)
- the lead fragment in the scope-specific AGENTS target (`install/AGENTS.fragment.md`)

AGENTS target:

- `user` — `~/.codex/AGENTS.md`
- `project` — the current repository's `./AGENTS.md`

Scope meanings:

- `user` — installs into `~/.codex` and shares the setup across repositories
- `project` — installs into the current repository's `./.codex`

## Project Knowledge

`codex-nexus` stores project knowledge and runtime state under `.nexus/`.

```text
.nexus/
  memory/     lessons learned, references
  context/    architecture and design context
  rules/      team rules
  history.json
  state/      active plan/task runtime state
```

- `memory/`, `context/`, `rules/`, and `history.json` hold project knowledge.
- `state/` holds runtime state and is excluded from git.

Resume-related runtime state lives primarily in:

- `.nexus/state/codex-nexus/agent-tracker.json`
- `.nexus/state/codex-nexus/tool-log.jsonl`

## CLI

```bash
bun run sync:core
codex-nexus install
codex-nexus install --core-only
codex-nexus install --scope user --version latest
codex-nexus install --scope project --version 0.2.0
codex-nexus doctor --scope project
codex-nexus version
```
