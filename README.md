# codex-nexus

Nexus orchestration plugin for OpenAI Codex CLI.

`codex-nexus` packages Nexus planning, task-based run cycles, context sync, Codex-native agents, and an `nx` MCP server into a Codex install surface.

## Requirements

- OpenAI Codex CLI
- `bun` available on `PATH`

`codex-nexus` is distributed through npm, but the installed hooks and MCP server execute with `bun`.

## Install

Global install:

```bash
npm install -g codex-nexus
codex-nexus install --scope user
```

Project-local install:

```bash
codex-nexus install --scope project
```

Refresh managed Codex Nexus assets from the currently installed package version:

```bash
codex-nexus update --scope user
```

`setup` is still accepted as a legacy alias, but `install` / `update` are the intended public commands.

## Scope

- `user` installs to `~/.codex` and is shared across repositories
- `project` installs to `./.codex` in the current repository

## What Install Writes

- `.codex/config.toml`
- `.codex/hooks.json`
- `.codex/skills/nx-init`
- `.codex/skills/nx-plan`
- `.codex/skills/nx-run`
- `.codex/skills/nx-sync`
- `.codex/agents/*.toml`
- `AGENTS.md` Nexus section

## Entrypoints

- `$nx-init`
- `[plan]`
- `[run]`
- `[sync]`

## Local Development

```bash
bun install
bun run build
bun test
```

Run the built CLI directly from this checkout:

```bash
bun ./dist/cli/index.js install --scope project --verbose
bun ./dist/cli/index.js doctor --scope project
```
