import { readFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createNexusPaths, ensureDir, ensureProjectGitignore, findProjectRoot } from "../shared/paths.js";
import { appendToolLog, ensureNexusStructure, upsertAgentTrackerEntry } from "../shared/state.js";
import { readTasksSummary } from "../shared/tasks.js";

type HookPayload = Record<string, unknown>;
type HookEventName = "SessionStart" | "UserPromptSubmit" | "PreToolUse" | "PostToolUse" | "Stop";

function safeString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function safeObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readHookEventName(payload: HookPayload): HookEventName | null {
  const raw = safeString(
    payload.hook_event_name ??
    payload.hookEventName ??
    payload.event ??
    payload.name
  ).trim();
  if (raw === "SessionStart" || raw === "UserPromptSubmit" || raw === "PreToolUse" || raw === "PostToolUse" || raw === "Stop") {
    return raw;
  }
  return null;
}

function readPrompt(payload: HookPayload): string {
  return safeString(payload.prompt ?? payload.user_prompt ?? payload.userPrompt).trim();
}

function readCommand(payload: HookPayload): string {
  return safeString(safeObject(payload.tool_input).command).trim();
}

function buildAdditionalContext(message: string): Record<string, unknown> {
  return {
    hookSpecificOutput: {
      additionalContext: message
    }
  };
}

function detectTag(prompt: string): string | null {
  const match = prompt.match(/\[(plan|run|sync|d|m(?::gc)?|rule(?::[^\]]+)?)\]/i);
  return match ? match[1].toLowerCase() : null;
}

function buildUserPromptContext(prompt: string): string | null {
  const tag = detectTag(prompt);
  if (tag === "plan") {
    return [
      "[nexus] Plan mode detected.",
      "Load and follow `$nx-plan`.",
      "Research before opening or restarting the plan session.",
      "Use nx_plan_status to inspect current state, then nx_plan_start only after research is complete."
    ].join(" ");
  }
  if (tag === "run") {
    return [
      "[nexus] Run mode detected.",
      "Load and follow `$nx-run`.",
      "Register tasks with nx_task_add before non-trivial execution and close the cycle with nx_task_close."
    ].join(" ");
  }
  if (tag === "sync") {
    return "[nexus] Sync mode detected. Load and follow `$nx-sync`, then refresh .nexus/context/ based on current repo state.";
  }
  if (tag === "d") {
    return "[nexus] Decision tag detected. Record the current issue with nx_plan_decide instead of leaving it as free text.";
  }
  if (tag === "rule") {
    return "[nexus] Rule tag detected. Save a durable convention under .nexus/rules/ with a concise title and reusable wording.";
  }
  if (tag && tag.startsWith("rule:")) {
    const ruleTag = tag.slice("rule:".length);
    return `[nexus] Tagged rule detected. Save a durable convention under .nexus/rules/ and include the tag "${ruleTag}" in the rule metadata.`;
  }
  if (tag === "m") {
    return "[nexus] Memory tag detected. Save non-recoverable lessons or references under .nexus/memory/ with a concise kebab-case filename.";
  }
  if (tag === "m:gc") {
    return "[nexus] Memory GC tag detected. Review .nexus/memory/ for overlap, merge related notes, and remove stale duplicates conservatively.";
  }
  if (/\$nx-(init|plan|run|sync)\b/i.test(prompt)) {
    return "[nexus] Nexus skill invocation detected. Load the referenced skill and follow its workflow precisely.";
  }
  return null;
}

async function handleSessionStart(cwd: string): Promise<Record<string, unknown> | null> {
  const paths = createNexusPaths(cwd);
  await ensureNexusStructure(paths);
  await ensureProjectGitignore(cwd);
  return buildAdditionalContext(
    "[nexus] Codex Nexus is active. Use AGENTS.md as the orchestration surface, `$nx-init` for onboarding, `[plan]` for decisions, and `[run]` for task-based execution."
  );
}

async function handleUserPromptSubmit(payload: HookPayload): Promise<Record<string, unknown> | null> {
  const prompt = readPrompt(payload);
  const message = buildUserPromptContext(prompt);
  if (!message) return null;
  return buildAdditionalContext(message);
}

async function handlePreToolUse(cwd: string, payload: HookPayload): Promise<Record<string, unknown> | null> {
  const command = readCommand(payload);
  if (!command) return null;

  const paths = createNexusPaths(cwd);
  const taskSummary = await readTasksSummary(paths);
  const mutating = /\b(rm|mv|cp|sed\s+-i|perl\s+-pi|git\s+commit|git\s+checkout|git\s+switch|git\s+reset)\b/.test(command);

  if (mutating && taskSummary.exists && taskSummary.total === 0) {
    return {
      decision: "block",
      reason: "Run mode requires task registration before mutating Bash commands. Use nx_task_add first."
    };
  }

  if (/^\s*rm\s+-rf\b/.test(command)) {
    return {
      decision: "block",
      reason: "Destructive Bash command detected. Confirm the target and expected side effects before retrying."
    };
  }

  return null;
}

async function handlePostToolUse(cwd: string, payload: HookPayload): Promise<Record<string, unknown> | null> {
  const command = readCommand(payload);
  if (!command) return null;

  const paths = createNexusPaths(cwd);
  await appendToolLog(paths.TOOL_LOG_FILE, {
    hook: "PostToolUse",
    tool_name: safeString(payload.tool_name),
    command
  });

  const response = safeObject(payload.tool_response);
  const exitCode = response.exit_code ?? response.exitCode;
  const stderr = safeString(response.stderr);
  const stdout = safeString(response.stdout);
  const combined = `${stderr}\n${stdout}`.trim();

  if ((exitCode === 127 || /command not found/i.test(combined)) && combined) {
    return {
      decision: "block",
      reason: "Bash reported a command/setup failure. Fix the command, PATH, dependency, or file path before retrying."
    };
  }

  return null;
}

async function handleStop(cwd: string): Promise<Record<string, unknown> | null> {
  const paths = createNexusPaths(cwd);
  const summary = await readTasksSummary(paths);
  if (!summary.exists) return null;
  if (summary.pending > 0 || summary.in_progress > 0) {
    return {
      decision: "block",
      reason: `Nexus cycle still active: ${summary.pending} pending, ${summary.in_progress} in progress. Finish work or update task state before stopping.`
    };
  }
  if (summary.allCompleted) {
    return {
      decision: "block",
      reason: "All tasks are complete but the cycle is not archived. Run nx_task_close before stopping."
    };
  }
  return null;
}

async function dispatch(payload: HookPayload): Promise<Record<string, unknown> | null> {
  const cwd = findProjectRoot(safeString(payload.cwd).trim() || process.cwd());
  const event = readHookEventName(payload);
  if (!event) return null;

  if (event === "SessionStart") return handleSessionStart(cwd);
  if (event === "UserPromptSubmit") return handleUserPromptSubmit(payload);
  if (event === "PreToolUse") return handlePreToolUse(cwd, payload);
  if (event === "PostToolUse") return handlePostToolUse(cwd, payload);
  if (event === "Stop") return handleStop(cwd);
  return null;
}

async function readStdinJson(): Promise<HookPayload> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  return JSON.parse(raw) as HookPayload;
}

export async function runCodexNativeHookCli(): Promise<void> {
  const payload = await readStdinJson();
  const result = await dispatch(payload);
  if (result) {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  }
}

if (import.meta.main) {
  runCodexNativeHookCli().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stdout.write(
      `${JSON.stringify({
        decision: "block",
        reason: `codex-nexus native hook failed: ${message}`
      })}\n`
    );
  });
}
