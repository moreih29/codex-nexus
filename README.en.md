[npm](https://www.npmjs.com/package/codex-nexus) · [License](./LICENSE) · [한국어](./README.md)

# codex-nexus

`codex-nexus` installs [`@moreih29/nexus-core`](https://github.com/moreih29/nexus-core) into the paths Codex actually uses.

After installation, it wires:

- the Lead main instruction file
- Nexus subagents
- the `nx` MCP server
- Codex hook definitions for Nexus tags (Codex v0.129+ requires trust opt-in)
- the Codex skill discovery path

## What it gives you

After installation and hook trust, you can use flows like:

- `[plan]` to structure decisions before implementation
- `[auto-plan]` for Lead-driven planning
- `[run]` to execute from a plan
- `[m]` to store memory
- `[m:gc]` to clean memory
- `[d]` to record the current plan decision

## Codex compatibility

This release targets **Codex CLI v0.129 and newer**. It installs against the canonical hook feature and trust model introduced for that line; older Codex fallback behavior is not documented as current behavior.

- Fresh installs write `[features].hooks = true`.
- Fresh installs do not write `[features].codex_hooks`.
- `codex_hooks` is mentioned only for migration/history handling of older codex-nexus installs or user-owned values.

## Quick install

Recommended default install:

```bash
npx -y codex-nexus install
```

In a TTY session, the installer lets you choose:

1. whether to install to `user` or `project` scope
2. whether to trust the installed codex-nexus hooks by writing `hooks.state`
3. whether to configure models immediately after installation

The default install writes hook definitions only and does not write trust state. For non-interactive trust, pass `--trust-hooks` explicitly.

```bash
npx -y codex-nexus install --trust-hooks
```

The installed version is always the same as the currently executed `codex-nexus` package.
If you want a different version, change the package version at invocation time.

## CLI commands

```bash
codex-nexus install [--scope user|project]
codex-nexus install [--scope user|project] --trust-hooks
codex-nexus models [--scope user|project]
codex-nexus models [--scope user|project] --targets default,engineer --model gpt-5.4
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

## Model selection

After installation, you can configure the Codex default model and Nexus subagent models per scope.
When you run `install` in a TTY, the installer also asks whether to continue directly into this model setup flow.

```bash
npx -y codex-nexus models --scope project
npx -y codex-nexus models --scope project --targets default,engineer,tester --model gpt-5.4
npx -y codex-nexus models --scope project --targets engineer,tester --model inherit
```

- In a TTY, the command prompts for scope, targets, and model. The initial scope selection is `project`.
- In non-interactive direct mode, pass `--targets` and `--model` together.
- The model choices include `inherit`. In direct mode, use `--model inherit`.
- `--agents` is supported as an alias for `--targets`.
- Current supported targets are `default`, `architect`, `designer`, `postdoc`, `engineer`, `researcher`, `writer`, `reviewer`, `tester`, and `all`.
- `all` includes `default` and only the currently supported non-lead subagents.
- `default` writes the top-level `model` in the scoped `.codex/config.toml`.
- Subagent targets write the top-level `model` in the scoped `.codex/agents/<agent>.toml`.
- Choosing `inherit` removes the target TOML's top-level `model` field. Subagents then inherit the top-level model from the scoped `.codex/config.toml`.
- `lead` is intentionally not configurable through this command.

Freshly installed subagent TOMLs do not include a `model` field.
Unless an explicit override is configured, subagents inherit the top-level model from the scoped `.codex/config.toml`.

Selections are also stored in the scoped `.codex/.codex-nexus/model-overrides.json`, so currently supported target model overrides are reapplied after future `codex-nexus install` runs.

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

- Lead instructions materialized inline as `developer_instructions`
- `[features].multi_agent = true`
- `[features].child_agents_md = true`
- `[features].hooks = true`
- `[mcp_servers.nx]`
- Codex v0.129+ inline hook wiring (`config.toml` `[hooks]`)
- hook definitions by default, without `hooks.state` trust entries unless you opt in
- `.codex/agents/*` (Nexus custom subagents)
- `.agents/skills/*`
- the marketplace entry
- a native hook-ready plugin manifest entry (`hooks: "./hooks.json"`)

This is the important distinction: it does not just copy a plugin folder. It wires the final-user config paths that Codex actually reads.
It also wires `nx` MCP through the installed runtime plus the installed `nexus-core` server entry, instead of relying on `npx` being present on PATH.
By contrast, the installed plugin bundle keeps its `agents/*.toml` files in their distributed `nexus-mcp` source form, while the runtime agent copies under `.codex/agents/*` get the resolved absolute launcher.

## Codex v0.129+ hooks and trust

`codex-nexus` now assumes Codex CLI v0.129 or newer and uses the **canonical `[features].hooks` + inline `config.toml` `[hooks]`** surface. Fresh installs do not write `[features].codex_hooks`, and older `.codex/hooks.json` fallback behavior is not supported as current behavior.

Update / migration rules:

- A prior codex-nexus-managed `[features].codex_hooks = true` is migrated/cleaned in favor of `[features].hooks = true`.
- User-owned `codex_hooks` values are preserved for migration and uninstall safety.
- Old codex-nexus-managed hooks in `.codex/hooks.json` are moved to or removed in favor of inline `[hooks]`; user-owned hooks are preserved.

Trust rules:

- Default `install` writes hook definitions only. It does not automatically write `hooks.state` trust entries.
- In a TTY, accept the “Trust installed codex-nexus hooks...” prompt to write trust entries.
- In non-interactive mode, pass `codex-nexus install --trust-hooks` to write trust entries.
- Even for `project` scope, trust entries are written to the current user's Codex config (`~/.codex/config.toml` by default). Project config does not receive `hooks.state`.

`doctor` checks v0.129 trust/runability states:

- missing or disabled `[features].hooks`
- missing codex-nexus hook surface
- untrusted hooks
- disabled hook state
- modified hooks after trust, such as command or timeout changes
- duplicate active native plugin hook and direct installer hook sources

The native plugin hook surface is prepared, but direct installer hooks remain the default runtime path. The plugin manifest includes `hooks: "./hooks.json"` so Codex native plugin loading can discover the hook spec, but this document does not claim native plugin hook runtime smoke while `plugin_hooks` remains default-off/experimental. If `plugin_hooks` is enabled while direct hooks are also active, `doctor` reports `native/direct hook duplicate` because duplicate execution is possible.

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

Immediately after the default install, `doctor` may report `hook trust (... untrusted)` because hook definitions exist but trust entries do not. To install and trust in one non-interactive step:

```bash
npx -y codex-nexus install --scope user --trust-hooks
npx -y codex-nexus doctor --scope user
```

After explicit trust or accepting the interactive trust prompt, a healthy setup prints `Doctor passed.`.

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

After installation and the required hook trust, you can start with prompts like:

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

- Hook behavior in this release targets Codex CLI v0.129 and newer. Older `codex_hooks` / `.codex/hooks.json` fallback behavior is not documented as current behavior.
- Default install does not automatically trust hooks. Until you pass `--trust-hooks` or accept the interactive prompt, `doctor` may report untrusted hooks.
- For project scope, hook trust still writes `hooks.state` to the current user's Codex config, not to project config.
- `nx` MCP uses the installer runtime path rather than a bare `npx` command.
- For project installs, the installer adds ignore entries for local install artifact directories to `.gitignore`.
- Uninstall is designed to preserve unrelated settings, but old installs without rollback metadata can only be cleaned up on a best-effort basis.

## Repository layout

The tracked publishable source of truth lives under `plugins/codex-nexus`.

- `plugins/codex-nexus/.codex-plugin/plugin.json`

By contrast, repo-root `.codex` and `.agents` are local outputs created by project-scope installs and are not tracked as source.
Most users do not need to manage those files directly. In practice, `codex-nexus install` is the entry point that matters.
