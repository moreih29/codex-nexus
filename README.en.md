[npm](https://www.npmjs.com/package/codex-nexus) · [License](./LICENSE) · [한국어](./README.md)

# codex-nexus

`codex-nexus` installs [`@moreih29/nexus-core`](https://github.com/moreih29/nexus-core) into the paths Codex actually uses.

After installation, it wires:

- the Lead main instruction file
- Nexus subagents
- the `nx` MCP server
- Codex hooks for Nexus tags
- the Codex skill discovery path

## What it gives you

Once installed, you can use flows like:

- `[plan]` to structure decisions before implementation
- `[auto-plan]` for Lead-driven planning
- `[run]` to execute from a plan
- `[m]` to store memory
- `[m:gc]` to clean memory
- `[d]` to record the current plan decision

## Quick install

Recommended default install:

```bash
npx -y codex-nexus install
```

In a TTY session, the installer lets you choose:

1. which published `codex-nexus` version to install
2. whether to install to `user` or `project` scope

Compatible installer versions start at `0.3.0`.

In non-interactive environments, omitting `--version` installs the same `codex-nexus` version that is currently being executed.

## Installation scopes

### user

```bash
npx -y codex-nexus install --scope user
```

Recommended when you want the setup available across repositories.

Installs into:

- `~/.codex`
- `~/.agents`

### project

```bash
npx -y codex-nexus install --scope project
```

Use this when you want the setup only for the current repository.

Installs into:

- `<repo>/.codex`
- `<repo>/.agents`
- `<repo>/plugins/codex-nexus`

## What the installer configures

The installer writes or updates:

- `model_instructions_file = "lead.instructions.md"`
- `[features].multi_agent = true`
- `[features].child_agents_md = true`
- `[features].codex_hooks = true`
- `[mcp_servers.nx]`
- `.codex/hooks.json`
- `.codex/agents/*`
- `.agents/skills/*`
- the marketplace entry

This is the important distinction: it does not just copy a plugin folder. It wires the final-user config paths that Codex actually reads.

## Verify the install

```bash
npx -y codex-nexus doctor --scope user
npx -y codex-nexus doctor --scope project
```

A healthy setup prints `Doctor passed.`.

## Example usage

After installation, you can start with prompts like:

```text
[plan] Help me break down the authentication flow
```

```text
[run] Implement the plan we just agreed on
```

```text
[m] Save what we learned from this outage
```

## Update

Re-run install to move to the latest compatible version:

```bash
npx -y codex-nexus install --scope user
```

To pin a version explicitly:

```bash
npx -y codex-nexus install --scope user --version 0.3.1
```

The installer also aligns the pinned `@moreih29/nexus-core` version from the selected `codex-nexus` package.

## Notes

- Versions below `0.3.0` are intentionally blocked by the current installer.
- Hooks are merged into Codex config-layer `hooks.json`.
- For project installs, the installer adds a minimal local-config ignore set to `.gitignore`.

## Marketplace layout

This repository follows the Codex marketplace layout:

- `.agents/plugins/marketplace.json`
- `plugins/codex-nexus/.codex-plugin/plugin.json`

Most users do not need to manage those files directly. In practice, `codex-nexus install` is the entry point that matters.
