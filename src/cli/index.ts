#!/usr/bin/env bun

import { parseCliArgs, type CliCommand, type CliCommandOptions } from "./args.js";
import { renderCommandHelp } from "./help.js";
import { getCurrentVersion } from "../shared/version.js";
import { doctorCommand, formatDoctorSummary } from "./doctor.js";
import { fetchPublishedVersions, formatInstallSummary, installCommand } from "./install.js";
import {
  beginInteractiveSession,
  endInteractiveSession,
  fallbackPromptVersion,
  fallbackPromptScope,
  isInteractiveTerminal,
  printInteractiveNote,
  promptInstallVersionMode,
  promptPublishedVersion,
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

async function resolveInstallVersion(options: CliCommandOptions, interactive: boolean): Promise<string> {
  if (options.version) return options.version;
  if (!interactive) return "latest";

  try {
    const mode = await promptInstallVersionMode("latest");
    if (mode === "latest") {
      return "latest";
    }
  } catch (error) {
    if (error instanceof Error && error.message === "Interrupted") {
      throw error;
    }
    return fallbackPromptVersion("latest");
  }

  try {
    const versions = (await fetchPublishedVersions()).slice().reverse();
    if (versions.length > 0) {
      return await promptPublishedVersion(versions, versions[0]);
    }
  } catch (error) {
    if (error instanceof Error && error.message === "Interrupted") {
      throw error;
    }
  }

  return fallbackPromptVersion("latest");
}

async function executeCommand(command: CliCommand, options: CliCommandOptions, interactive: boolean): Promise<number> {
  if (command === "install") {
    const version = await resolveInstallVersion(options, interactive);
    const scope = await resolveScope(command, options, interactive);
    const run = () => installCommand({ scope, version, coreOnly: options.coreOnly });
    const result = interactive
      ? await runWithSpinner("Installing Codex Nexus surfaces...", run)
      : await run();
    const summary = formatInstallSummary(result, options.verbose);
    if (interactive) {
      printInteractiveNote("Installed surfaces", [
        `.codex/packages/node_modules/codex-nexus`,
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

  if (command === "doctor") {
    const scope = await resolveScope(command, options, interactive);
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
