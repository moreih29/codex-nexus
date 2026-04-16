# codex-nexus

Nexus orchestration plugin for OpenAI Codex CLI.

`codex-nexus` packages Nexus planning, task-based run cycles, context sync, Codex-native agents, and an `nx` MCP server into a Codex install surface.

## Install

`codex-nexus` is published through npm, but its runtime uses `bun`.

```bash
npm install -g codex-nexus
codex-nexus setup --scope user
```

Project-local install:

```bash
codex-nexus setup --scope project
```

## What Setup Installs

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

## Development

```bash
bun install
bun run build
bun test
```
