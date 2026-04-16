---
name: nx-init
description: "Project onboarding — scan, mission, essentials, context generation"
trigger_display: "$nx-init"
purpose: "Project onboarding — scan, mission, essentials, context generation"
---

## Role

Scans the project and builds Nexus knowledge in the flat .nexus/ structure. On first run, performs a 5-step full onboarding sequence.

## Constraints

- NEVER modify source code. Slimming down the instruction file beyond the project section is not this skill's responsibility.
- NEVER infer or guess information that cannot be confirmed from code — do not write it to context/.
- NEVER store secrets (API keys, credentials, etc.) in knowledge files.
- NEVER overwrite existing files without `--reset`. On resume, preserve existing files intact.
- Project section in the instruction file MUST go through user confirmation before writing.
- NEVER reference or create identity/, codebase/, reference/, or core/ paths.
- Essentials section MUST NOT exceed 10 lines. If more items are needed, move lower-priority ones to .nexus/context/.

## Guidelines

## Trigger

- Manual trigger — full onboarding (or resume). See harness docs: slash_command_display.
- Manual trigger with `--reset` flag — back up existing `.nexus/` knowledge and re-onboard. See harness docs: slash_command_display.
- Manual trigger with `--reset --cleanup` flags — show backup list + selective deletion. See harness docs: slash_command_display.

---

## Modes

### First Run (no `.nexus/` flat structure)

Automatically runs the 5-step full onboarding.

Detection: `.nexus/context/`, `.nexus/memory/`, `.nexus/state/`, `.nexus/rules/` do not exist.

### Resume (`.nexus/` partially exists)

Check existing state and resume from the first incomplete step.

### Reset (`--reset`)

Back up existing `.nexus/` knowledge directories to `.nexus/bak.{timestamp}/`, then enter First Run.

### Cleanup (`--reset --cleanup`)

Show backup directory list, let user select backups to delete.

---

## Process

### Phase 0: Mode Detection

```
IF --reset --cleanup flag:
  Show list of .nexus/bak.*/ directories
  Prompt user with options via `Ask the user this question directly: Select a backup to delete (or cancel)
Options: [<backup list...>, {label: Cancel, description: "Exit without changes"}]`.
  Delete selected backup and exit

ELSE IF --reset flag:
  Move .nexus/{memory,context,state,rules}/ → .nexus/bak.{timestamp}/
  Inform: "Existing knowledge has been backed up to .nexus/bak.{timestamp}/. Starting re-onboarding."
  → Enter First Run

ELSE IF .nexus/context/ exists:
  → Enter Resume (check existing steps and resume)

ELSE:
  → Enter First Run (from Step 1)
```

---

## Steps

### Step 1: Project Scan

Auto-detect code structure and tech stack. Create the flat `.nexus/` directory structure if it does not exist.

Create directories (using shell command execution):
- `.nexus/memory/`
- `.nexus/context/`
- `.nexus/state/`
- `.nexus/rules/`

Collected items:
- **Directory structure**: top-level layout, major modules/packages
- **Tech stack**: language, framework, runtime (package.json, Cargo.toml, pyproject.toml, go.mod, build.gradle, etc.)
- **Build/test system**: scripts, CI configuration
- **Existing docs**: CLAUDE.md, README.md, docs/, .cursorrules, etc.
- **git context**: recent commits, branch structure, contributors

Output: scan summary (language, framework, structure overview)

For large projects (10+ top-level directories or 100+ files), consider spawning an Explore subagent for parallel scanning to reduce Lead context usage.

### Step 2: Mission + Essentials (Interactive)

Using the Step 1 scan results, draft a Mission statement (1–2 lines) and an Essentials list, then present both to the user for confirmation in a single pass.

#### Essentials Guidelines

Essentials are agent-critical facts — things an agent would get wrong if it didn't know them. Apply this judgment criterion: **"Would an agent produce wrong results without knowing this?"** Yes → Essentials. No → .nexus/context/.

Draft from these five categories (include only what applies to this project):

- **Tech stack** — runtime, language, package manager, core framework. Flag non-default tools (e.g. bun instead of npm, deno instead of node).
- **Workflow** — build, test, deploy commands. Must-follow procedures such as required lint or type-check steps before committing.
- **Constraints** — forbidden tools, patterns, or approaches. Directories or files that must not be modified.
- **Domain** — target audience, required terminology or tone, compliance or regulatory constraints, methodology for research projects.
- **Conventions** — naming, structure, or style that deviate from general defaults. Project-specific patterns an agent would not infer.

Do not include items that are standard defaults for the detected tech stack. Do not exceed 10 lines total in the Essentials section.

#### Draft Presentation

Present the full draft to the user in this format:

```
The following will be added to the instruction file (see harness docs: instruction_file) (existing content will not be changed):

<!-- PROJECT:START -->
## {project-name}

{mission 1-2 lines}

### Essentials
- {auto-detected item}
- {auto-detected item}
<!-- PROJECT:END -->

Any changes?
```

Wait for the user to confirm or provide edits. Apply all changes in one pass — do not ask about Mission and Essentials separately.

After confirmation, write the section into the instruction file inside markers using the harness's file-editing primitive. If the instruction file already contains `<!-- PROJECT:START -->` markers, replace the content between them. If the instruction file does not exist, create it with the markers.

### Step 3: Context Knowledge Auto-Generation

Analyze Step 1 scan results to generate context knowledge documents in `.nexus/context/`.

Principles:
- File names and content are decided freely based on project characteristics. No fixed templates.
- Existing docs are information sources only — do not replicate their structure verbatim.
- Do not guess content that cannot be confirmed from code.
- Typically 1-3 files are sufficient. More files are not better.
- **Generate abstract-level content only** — design patterns, architecture direction, module relationships, conventions. Do NOT include code-level details such as file listings, function signatures, or import maps. Those can be read directly from code.

Generation targets (select and name based on what the project actually needs):
- Development stack (languages, frameworks, runtimes, key dependencies, build/test/deploy workflow)
- Design and architecture (module relationships, data flow, core entry points, conventions)
- Implementation specifics (pipeline details, configuration patterns, file structure conventions, tool restrictions — anything too specific for the instruction file but not readable from code alone)

Use the harness's file-creation primitive to create files at `.nexus/context/{chosen-name}.md`.

For large projects, spawn Writer subagents per topic to generate context knowledge in parallel. Lead coordinates and reviews outputs.

On completion: "context knowledge N files generated"

### Step 4: Rules Initial Setup (Optional)

Check whether team custom rules are needed.

```
Ask the user this question directly: Do you want to set up development rules now?
Options: [{label: "Set up", description: "Coding conventions, test policy, commit rules, etc."}, {label: Skip, description: "Can be added later via [rule] tag"}]
```

If "Set up": present a draft based on scan results → user confirms → save via the harness's file-creation primitive to `.nexus/rules/{topic}.md`.

If "Skip": inform and proceed to Step 5.

### Step 5: Completion Summary

Output a summary of the onboarding results.

```
## Nexus Initialization Complete

### Generated Files
- instruction file: project section — mission and essentials (<!-- PROJECT:START/END -->)
- .nexus/context/: {list of generated files}
- .nexus/rules/: {generated files or "none (skipped)"}

### Next Steps
- [plan] — research, analyze, and plan before execution
- [run] — execute from a plan
- Manual re-run trigger with `--reset` flag — re-run onboarding (existing knowledge will be backed up). See harness docs: slash_command_display.
```

