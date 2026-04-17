import { stdin as input, stdout as output } from "node:process";
import * as readline from "node:readline/promises";
import { confirm, intro, isCancel, note, outro, select, spinner, type Option } from "@clack/prompts";
import type { SetupScope } from "../shared/paths.js";
import type { CliCommand } from "./args.js";

export function isInteractiveTerminal(): boolean {
  if (process.env.CODEX_NEXUS_FORCE_TTY === "1") {
    return true;
  }
  if (process.env.CODEX_NEXUS_FORCE_TTY === "0") {
    return false;
  }
  return Boolean(input.isTTY) && Boolean(output.isTTY);
}

export function beginInteractiveSession(command: CliCommand): void {
  intro(`codex-nexus ${command}`);
}

export function endInteractiveSession(summary: string): void {
  outro(summary);
}

export function printInteractiveNote(title: string, body: string): void {
  note(body, title);
}

export async function promptScope(command: CliCommand, defaultValue: SetupScope = "user"): Promise<SetupScope> {
  const message = command === "doctor"
    ? "Which installation scope do you want to inspect?"
    : "Which installation scope do you want to target?";

  const selection = await select({
    message,
    initialValue: defaultValue,
    options: [
      {
        value: "user",
        label: "user",
        hint: "~/.codex shared across projects"
      },
      {
        value: "project",
        label: "project",
        hint: "./.codex inside the current repository"
      }
    ] satisfies Option<SetupScope>[]
  });

  if (isCancel(selection)) {
    throw new Error("Interrupted");
  }

  return selection as SetupScope;
}

export async function promptInstallVersionMode(defaultValue: "latest" | "specific" = "latest"): Promise<"latest" | "specific"> {
  const selection = await select({
    message: "Which codex-nexus version do you want to install?",
    initialValue: defaultValue,
    options: [
      {
        value: "latest",
        label: "latest",
        hint: "Recommended"
      },
      {
        value: "specific",
        label: "Choose published version",
        hint: "Select from the npm registry list"
      }
    ] satisfies Option<"latest" | "specific">[]
  });

  if (isCancel(selection)) {
    throw new Error("Interrupted");
  }

  return selection as "latest" | "specific";
}

export async function promptPublishedVersion(versions: string[], defaultValue?: string): Promise<string> {
  const normalized = versions.filter((version) => version.trim().length > 0);
  if (normalized.length === 0) {
    throw new Error("No published versions available.");
  }

  const selection = await select({
    message: "Select a published codex-nexus version",
    initialValue: defaultValue ?? normalized[0],
    options: normalized.map((version, index) => ({
      value: version,
      label: version,
      hint: index === 0 ? "Latest published" : undefined
    })) satisfies Option<string>[]
  });

  if (isCancel(selection)) {
    throw new Error("Interrupted");
  }

  return selection as string;
}

export async function fallbackPromptVersion(defaultValue = "latest"): Promise<string> {
  const rl = readline.createInterface({ input, output });

  try {
    while (true) {
      const answer = (await rl.question(`Version to install [${defaultValue}]: `)).trim();
      if (answer) return answer;
      if (defaultValue) return defaultValue;
      output.write("Enter a version or dist-tag.\n");
    }
  } finally {
    rl.close();
  }
}

export async function promptContinue(message: string, initialValue = true): Promise<boolean> {
  const result = await confirm({
    message,
    initialValue
  });
  if (isCancel(result)) {
    throw new Error("Interrupted");
  }
  return Boolean(result);
}

export async function runWithSpinner<T>(message: string, task: () => Promise<T>): Promise<T> {
  const s = spinner();
  s.start(message);
  try {
    const result = await task();
    s.stop("Done");
    return result;
  } catch (error) {
    s.stop("Failed");
    throw error;
  }
}

export async function fallbackPromptScope(command: CliCommand, defaultValue: SetupScope = "user"): Promise<SetupScope> {
  const rl = readline.createInterface({ input, output });
  const prompt = command === "doctor"
    ? `Scope to inspect [${defaultValue}] (user/project): `
    : `Target scope [${defaultValue}] (user/project): `;

  try {
    while (true) {
      const answer = (await rl.question(prompt)).trim().toLowerCase();
      if (!answer) return defaultValue;
      if (answer === "user" || answer === "project") return answer;
      output.write("Choose either user or project.\n");
    }
  } finally {
    rl.close();
  }
}
