# codex-nexus

[![npm version](https://img.shields.io/npm/v/codex-nexus)](https://www.npmjs.com/package/codex-nexus)

> 🌏 [한국어](README.md)

Nexus orchestration plugin for OpenAI Codex CLI.

`codex-nexus` turns Codex tool calls and agent execution into a structured Nexus workflow. Instead of pushing straight into implementation, it helps you plan first, record decisions, execute through tasks, and keep project knowledge under `.nexus/`.

## Why

- plan before implementation with `[plan]`
- execute through task-based `[run]`
- keep project knowledge and decisions in `.nexus/`
- use a Codex-native specialist agent catalog
- access plan/task/history/context flows through `nx` MCP tools

## Quick Start

### 1. Install

`codex-nexus` is distributed through npm, but the installed hooks and MCP server execute with `bun`.

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

To install explicitly:

```bash
codex-nexus install --scope user --version latest
codex-nexus install --scope project --version 0.1.0
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

## What Install Writes

An install updates these managed surfaces under the selected scope:

- `.codex/packages/node_modules/codex-nexus`
- `.codex/config.toml`
- `.codex/hooks.json`
- `.codex/skills/nx-init`
- `.codex/skills/nx-plan`
- `.codex/skills/nx-run`
- `.codex/skills/nx-sync`
- `.codex/agents/*.toml`
- the Codex Nexus section in `AGENTS.md`

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

## CLI

```bash
codex-nexus install
codex-nexus install --scope user --version latest
codex-nexus install --scope project --version 0.1.0
codex-nexus doctor --scope project
codex-nexus version
```
