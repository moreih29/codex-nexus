# codex-nexus

Nexus orchestration plugin for OpenAI Codex CLI.

`codex-nexus` packages Nexus planning, task-based run cycles, context sync, Codex-native agents, and an `nx` MCP server into a Codex install surface.

## Status

`codex-nexus` is still in pre-release bootstrap. The first public npm release has not been published yet.

Until that first release lands:

- use this repository for development and local verification
- expect the install/update CLI surface to keep tightening
- treat the npm install commands below as the intended release flow, not something available from npm today

## Requirements

- OpenAI Codex CLI
- `bun` available on `PATH`

`codex-nexus` is intended to be distributed through npm, but the installed hooks and MCP server execute with `bun`.

## Planned Install Flow

After the first npm release, the intended global install flow is:

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

Current bootstrap builds still accept `setup` as a legacy alias, but `install` / `update` are the intended public commands.

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

Bootstrap and verify from this checkout:

```bash
bun install
bun run build
bun test
```

Run the built CLI directly before the first npm publish:

```bash
bun ./dist/cli/index.js install --scope project --verbose
bun ./dist/cli/index.js doctor --scope project
```
