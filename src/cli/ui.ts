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
