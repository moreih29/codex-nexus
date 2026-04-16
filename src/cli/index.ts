#!/usr/bin/env bun

import { parseCliArgs, type CliCommand, type CliCommandOptions } from "./args.js";
import { renderCommandHelp } from "./help.js";
import { getCurrentVersion } from "../shared/version.js";
import { doctorCommand, formatDoctorSummary } from "./doctor.js";
import { formatSetupSummary, setupCommand } from "./setup.js";
import { updateCommand } from "./update.js";
import {
  beginInteractiveSession,
  endInteractiveSession,
  fallbackPromptScope,
  isInteractiveTerminal,
  printInteractiveNote,
  promptScope,
  runWithSpinner
} from "./ui.js";

async function resolveScope(command: CliCommand, options: CliCommandOptions, interactive: boolean): Promise<"user" | "project"> {
  if (options.scope) return options.scope;
  if (!interactive) return "user";

  try {
    return await promptScope(command, "user");
  } catch (error) {
    if (error instanceof Error && error.message === "Interrupted") {
      throw error;
    }
    return fallbackPromptScope(command, "user");
  }
}

async function executeCommand(command: CliCommand, options: CliCommandOptions, interactive: boolean): Promise<number> {
  const scope = await resolveScope(command, options, interactive);

  if (command === "setup" || command === "install") {
    const run = () => setupCommand({ scope });
    const result = interactive
      ? await runWithSpinner("Installing Codex Nexus surfaces...", run)
      : await run();
    const summary = formatSetupSummary("setup", result, options.verbose);
    if (interactive) {
      printInteractiveNote("Installed surfaces", [
        `.codex/config.toml`,
        `.codex/hooks.json`,
        `.codex/skills/*`,
        `.codex/agents/*.toml`,
        `AGENTS.md`
      ].join("\n"));
      endInteractiveSession(summary);
    } else if (options.verbose) {
      console.log(summary);
    }
    return 0;
  }

  if (command === "update") {
    const run = () => updateCommand(scope);
    const result = interactive
      ? await runWithSpinner("Refreshing Codex Nexus surfaces...", run)
      : await run();
    const summary = formatSetupSummary("update", result, options.verbose);
    if (interactive) {
      endInteractiveSession(summary);
    } else if (options.verbose) {
      console.log(summary);
    }
    return 0;
  }

  if (command === "doctor") {
    const run = () => doctorCommand(scope);
    const result = interactive
      ? await runWithSpinner("Inspecting Codex Nexus installation...", run)
      : await run();
    const summary = formatDoctorSummary(result);
    if (interactive) {
      endInteractiveSession(summary);
    } else {
      console.log(summary);
    }
    return result.failed === 0 ? 0 : 1;
  }

  return 1;
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const parsed = parseCliArgs(argv);

  if (parsed.kind === "version") {
    console.log(getCurrentVersion());
    return 0;
  }

  if (parsed.kind === "help") {
    console.log(renderCommandHelp(parsed.command));
    return 0;
  }

  if (parsed.kind === "error") {
    console.error(parsed.message);
    console.error("");
    console.error(renderCommandHelp(parsed.command));
    return 1;
  }

  const interactive = isInteractiveTerminal();
  if (interactive) {
    beginInteractiveSession(parsed.command);
  }
  return executeCommand(parsed.command, parsed.options, interactive);
}

if (import.meta.main) {
  main().then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
