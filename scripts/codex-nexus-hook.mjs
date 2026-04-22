#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const NEXUS_GITIGNORE = `# Nexus: whitelist tracked files, ignore everything else
*
!.gitignore
!context/
!context/**
!memory/
!memory/**
!history.json
`;

const TAG_INSTRUCTIONS = new Map([
  ["[plan]", "Activate the nx-plan skill."],
  ["[auto-plan]", "Activate the nx-auto-plan skill."],
  ["[run]", "Activate the nx-run skill."],
  ["[m]", "Save the following content into `.nexus/memory/` using the proper empirical-/external-/pattern- filename convention."],
  ["[m:gc]", "Clean up `.nexus/memory/` by merging duplicates and removing stale entries."],
  ["[d]", "Record the current plan issue decision with `nx_plan_decide`."]
]);

const BLOCKED_GIT_PATTERNS = [
  {
    pattern: /(^|\s)git\s+add\s+(-A|--all)(\s|$)/i,
    reason: "Nexus policy: use explicit git add paths instead of `git add -A`."
  },
  {
    pattern: /(^|\s)git\s+reset\s+--hard(\s|$)/i,
    reason: "Nexus policy: destructive `git reset --hard` requires explicit user instruction."
  },
  {
    pattern: /(^|\s)git\s+push(?:\s+[^\n]+)?\s+(--force|-f)(\s|$)/i,
    reason: "Nexus policy: force push requires explicit user instruction."
  },
  {
    pattern: /(^|\s)git\s+branch\s+-D(\s|$)/i,
    reason: "Nexus policy: deleting branches with `git branch -D` requires explicit user instruction."
  },
  {
    pattern: /(^|\s)git\s+rebase\s+-i(\s|$)/i,
    reason: "Nexus policy: interactive rebase requires explicit user instruction."
  }
];

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function printJson(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function ensureNexusLayout(cwd) {
  const nexusDir = path.join(cwd, ".nexus");
  const contextDir = path.join(nexusDir, "context");
  const memoryDir = path.join(nexusDir, "memory");
  const gitignorePath = path.join(nexusDir, ".gitignore");

  mkdirSync(contextDir, { recursive: true });
  mkdirSync(memoryDir, { recursive: true });

  if (!existsSync(gitignorePath)) {
    writeFileSync(gitignorePath, NEXUS_GITIGNORE, "utf8");
  }
}

function detectLeadingTag(prompt) {
  const match = prompt.match(/^\s*(\[(?:plan|auto-plan|run|m(?::gc)?|d)\])(?:\s|$)/);
  return match?.[1] ?? null;
}

function buildUserPromptContext(tag, cwd) {
  const base = TAG_INSTRUCTIONS.get(tag);
  if (!base) {
    return null;
  }

  if (tag === "[d]") {
    const planPath = path.join(cwd, ".nexus", "state", "plan.json");
    if (!existsSync(planPath)) {
      return `${base} If no active plan session exists, explain that \`[d]\` is only valid inside an active plan session.`;
    }
  }

  if (tag === "[run]") {
    const tasksPath = path.join(cwd, ".nexus", "state", "tasks.json");
    if (!existsSync(tasksPath)) {
      return `${base} If \`.nexus/state/tasks.json\` is missing, invoke nx-auto-plan first and then continue with nx-run.`;
    }
  }

  return base;
}

function handleSessionStart(input) {
  ensureNexusLayout(input.cwd);
}

function handleUserPromptSubmit(input) {
  const tag = detectLeadingTag(input.prompt ?? "");
  if (!tag) {
    return;
  }

  const additionalContext = buildUserPromptContext(tag, input.cwd);
  if (!additionalContext) {
    return;
  }

  printJson({
    systemMessage: `Nexus tag detected: ${tag}`,
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext
    }
  });
}

function handlePreToolUse(input) {
  const command = input.tool_input?.command ?? input.toolInput?.command ?? "";
  for (const candidate of BLOCKED_GIT_PATTERNS) {
    if (candidate.pattern.test(command)) {
      printJson({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: candidate.reason
        }
      });
      return;
    }
  }
}

async function main() {
  const mode = process.argv[2];
  if (!mode) {
    process.stderr.write("Missing hook mode.\n");
    process.exit(1);
  }

  const rawInput = await readStdin();
  const input = rawInput.trim() ? JSON.parse(rawInput) : {};

  switch (mode) {
    case "session-start":
      handleSessionStart(input);
      return;
    case "user-prompt-submit":
      handleUserPromptSubmit(input);
      return;
    case "pre-tool-use":
      handlePreToolUse(input);
      return;
    default:
      process.stderr.write(`Unsupported hook mode: ${mode}\n`);
      process.exit(1);
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
