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

1. whether to install to `user` or `project` scope

The installed version is always the same as the currently executed `codex-nexus` package.
If you want a different version, change the package version at invocation time.

## CLI commands

```bash
codex-nexus install [--scope user|project]
codex-nexus uninstall [--scope user|project]
codex-nexus doctor [--scope user|project]
codex-nexus version
codex-nexus --version
```

Version examples:

```bash
npx -y codex-nexus version
npx -y codex-nexus --version
```

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
- managed Codex hook wiring (inline `config.toml [hooks]` or legacy `.codex/hooks.json`)
- `.codex/agents/*`
- `.agents/skills/*`
- the marketplace entry

This is the important distinction: it does not just copy a plugin folder. It wires the final-user config paths that Codex actually reads.
It also wires `nx` MCP through the installed runtime plus the installed `nexus-core` server entry, instead of relying on `npx` being present on PATH.
By contrast, the installed plugin bundle keeps its `agents/*.toml` files in their distributed `nexus-mcp` source form, while the runtime agent copies under `.codex/agents/*` get the resolved absolute launcher.

## Hook compatibility

`codex-nexus` writes its **managed Codex hooks** to exactly one surface per `.codex/` layer. Re-running install/update does not duplicate the same managed hooks across both inline `[hooks]` and `.codex/hooks.json`.

The selection rules are conservative:

- if inline `[hooks]` already exist in `config.toml`, codex-nexus keeps using that surface
- if inline `[hooks]` do not already exist and `.codex/hooks.json` does, codex-nexus keeps using the legacy surface
- if neither surface exists yet, inline `config.toml [hooks]` is enabled only when `codex --version` is `0.124.0` or newer
- if the Codex CLI version is unknown or older than `0.124.0`, codex-nexus falls back to `.codex/hooks.json`

Managed matcher/runtime coverage:

- `PreToolUse` and `PermissionRequest` match `Bash`, `apply_patch` / `Edit` / `Write`, and `mcp__.*`
- the hook runtime normalizes Bash, `apply_patch`, and MCP event inputs
- existing Bash deny rules remain Bash-only
- `PostToolUse` is intentionally unchanged

## Uninstall

To remove the setup, run uninstall with the same scope.

```bash
npx -y codex-nexus uninstall --scope user
npx -y codex-nexus uninstall --scope project
```

Behavioral contract:

- codex-nexus tries to revert or remove only the files and settings it manages
- unrelated hook, marketplace, and config content should be preserved whenever possible
- fresh installs persist rollback metadata so uninstall can restore more precisely later
- older installs without metadata fall back to a conservative best-effort cleanup path

In practice, uninstall is designed around **reverting only the codex-nexus-managed surfaces**, not blindly restoring whole merged files.

## Verify the install

```bash
npx -y codex-nexus doctor --scope user
npx -y codex-nexus doctor --scope project
```

A healthy setup prints `Doctor passed.`.

## cmux notifications

`codex-nexus` also provides best-effort cmux status and notification updates through Codex hooks.

Requirements:

- Codex must be running inside cmux (`CMUX_WORKSPACE_ID` present)
- the `cmux` CLI must be available on PATH

Behavior:

- when work starts or Bash execution resumes, it refreshes a `Running` status pill
- when a response completes, it sends a `Response ready` notification and sets `Needs Input`
- when Codex asks for approval, it sends a `Permission requested` notification and sets `Needs Input`

The default cmux presentation matches:

- icon: `bolt` / `bell`
- status: `Running` / `Needs Input`
- color: `#007AFF`

To disable the cmux integration:

```bash
CODEX_NEXUS_CMUX=0 codex
# or
CODEX_NEXUS_CMUX=false codex
```

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

To install a specific version explicitly:

```bash
npx -y codex-nexus@<version> install --scope user
bunx codex-nexus@<version> install --scope user
```

The installer also aligns the pinned `@moreih29/nexus-core` version from the currently executed `codex-nexus` package.

## Notes

- codex-nexus-managed hooks follow conservative surface-selection rules. Existing inline hooks stay inline, existing `hooks.json` stays legacy when inline hooks are not already present, and only a fresh surface selection on supported Codex enables inline `config.toml [hooks]`.
- `nx` MCP uses the installer runtime path rather than a bare `npx` command.
- For project installs, the installer adds ignore entries for local install artifact directories to `.gitignore`.
- Uninstall is designed to preserve unrelated settings, but old installs without rollback metadata can only be cleaned up on a best-effort basis.

## Repository layout

The tracked publishable source of truth lives under `plugins/codex-nexus`.

- `plugins/codex-nexus/.codex-plugin/plugin.json`

By contrast, repo-root `.codex` and `.agents` are local outputs created by project-scope installs and are not tracked as source.
Most users do not need to manage those files directly. In practice, `codex-nexus install` is the entry point that matters.
