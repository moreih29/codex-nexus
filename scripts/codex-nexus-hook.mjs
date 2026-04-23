#!/usr/bin/env node

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";

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
  ["[d]", "Record the current plan issue decision with `nx_plan_decide`." ]
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

const CMUX_STATUS_KEY = "nexus-state";
const CMUX_STATUS_COLOR = "#007AFF";
const CMUX_RUNNING_ICON = "oct-zap";
const CMUX_RUNNING_VALUE = "Running";
const CMUX_NEEDS_INPUT_ICON = "bell.fill";
const CMUX_NEEDS_INPUT_VALUE = "Needs Input";
const CMUX_DEDUPE_WINDOW_MS = 1500;
const CMUX_DEDUPE_RETENTION_MS = 5 * 60 * 1000;
const CMUX_NOTIFICATION_PREVIEW_MAX_CHARS = 96;
const CMUX_PERMISSION_FALLBACK = "Permission requested";
const CMUX_STOP_FALLBACK = "Response ready";

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

function isCmuxEnabled() {
  if (!process.env.CMUX_WORKSPACE_ID) {
    return false;
  }
  const flag = process.env.CODEX_NEXUS_CMUX;
  if (flag === "0" || flag === "false") {
    return false;
  }
  return true;
}

function isSubagentEvent(input) {
  return typeof input?.agent_id === "string" && input.agent_id.length > 0;
}

function hashText(value) {
  return createHash("sha256").update(value).digest("hex");
}

function getCmuxDedupeDir(input) {
  const workspaceId = process.env.CMUX_WORKSPACE_ID ?? "workspace";
  const scope = `${workspaceId}:${input?.cwd ?? process.cwd()}`;
  return path.join(tmpdir(), "codex-nexus", "cmux-dedupe", hashText(scope).slice(0, 16));
}

function pruneCmuxDedupeEntries(cacheDir, nowMs) {
  let entries;
  try {
    entries = readdirSync(cacheDir);
  } catch {
    return;
  }

  for (const entry of entries) {
    const entryPath = path.join(cacheDir, entry);
    let stats;
    try {
      stats = statSync(entryPath);
    } catch {
      continue;
    }

    if (nowMs - stats.mtimeMs > CMUX_DEDUPE_RETENTION_MS) {
      try {
        unlinkSync(entryPath);
      } catch {}
    }
  }
}

function shouldEmitCmuxEffect(input, signature) {
  const cacheDir = getCmuxDedupeDir(input);
  const nowMs = Date.now();
  const markerPath = path.join(cacheDir, `${hashText(signature)}.json`);
  const markerPayload = JSON.stringify({ timestamp: nowMs });

  try {
    mkdirSync(cacheDir, { recursive: true });
    pruneCmuxDedupeEntries(cacheDir, nowMs);
  } catch {
    return true;
  }

  try {
    writeFileSync(markerPath, markerPayload, { encoding: "utf8", flag: "wx" });
    return true;
  } catch (error) {
    if (error?.code !== "EEXIST") {
      return true;
    }
  }

  let previousTimestamp = Number.NaN;
  try {
    previousTimestamp = Number(JSON.parse(readFileSync(markerPath, "utf8"))?.timestamp);
  } catch {}

  if (Number.isFinite(previousTimestamp) && nowMs - previousTimestamp < CMUX_DEDUPE_WINDOW_MS) {
    return false;
  }

  try {
    writeFileSync(markerPath, markerPayload, "utf8");
  } catch {}

  return true;
}

function firstNonEmptyString(candidates) {
  for (const candidate of candidates) {
    if (typeof candidate !== "string") {
      continue;
    }
    const trimmed = candidate.trim();
    if (trimmed) {
      return trimmed;
    }
  }
  return null;
}

function extractText(value, depth = 0) {
  if (depth > 4 || value == null) {
    return null;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = extractText(item, depth + 1);
      if (found) {
        return found;
      }
    }
    return null;
  }

  if (typeof value !== "object") {
    return null;
  }

  for (const key of ["text", "output_text", "outputText", "content", "message"]) {
    if (!Object.hasOwn(value, key)) {
      continue;
    }
    const found = extractText(value[key], depth + 1);
    if (found) {
      return found;
    }
  }

  return null;
}

function isPreCheckParagraph(paragraph) {
  const firstLine = paragraph
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);

  if (!firstLine) {
    return false;
  }

  if (/^\d+\)\s/.test(firstLine)) {
    return true;
  }

  return /^-\s*(First impression|Doubts|Action)\b/i.test(firstLine);
}

function stripLeadingPreCheckBlock(text) {
  const trimmed = text.trim();
  if (!/^\[Pre-check\]/i.test(trimmed)) {
    return trimmed;
  }

  const withoutHeading = trimmed.replace(/^\[Pre-check\]\s*/i, "").trim();
  if (!withoutHeading) {
    return "";
  }

  const paragraphs = withoutHeading
    .split(/\r?\n\s*\r?\n+/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  let skipCount = 0;
  while (skipCount < paragraphs.length && isPreCheckParagraph(paragraphs[skipCount])) {
    skipCount += 1;
  }

  const remainder = paragraphs.slice(skipCount).join("\n\n").trim();
  return remainder || withoutHeading;
}

function truncatePreview(text, maxChars = CMUX_NOTIFICATION_PREVIEW_MAX_CHARS) {
  const chars = Array.from(text);
  if (chars.length <= maxChars) {
    return text;
  }
  return `${chars.slice(0, Math.max(1, maxChars - 1)).join("")}…`;
}

function buildNotificationPreview(sourceText, fallback) {
  if (typeof sourceText !== "string" || !sourceText.trim()) {
    return fallback;
  }

  const withoutPreCheck = stripLeadingPreCheckBlock(sourceText);
  const normalized = (withoutPreCheck || sourceText).replace(/\s+/g, " ").trim();
  if (!normalized) {
    return fallback;
  }

  return truncatePreview(normalized);
}

function buildPermissionNotificationBody(input) {
  const source = firstNonEmptyString([
    input?.request_text,
    input?.requestText,
    input?.tool_input?.description,
    input?.toolInput?.description,
    input?.tool_input?.command,
    input?.toolInput?.command
  ]);
  return buildNotificationPreview(source, CMUX_PERMISSION_FALLBACK);
}

function buildStopNotificationBody(input) {
  const source = firstNonEmptyString([
    input?.last_assistant_message,
    input?.lastAssistantMessage,
    input?.output_text,
    input?.outputText,
    extractText(input?.assistant_response),
    extractText(input?.assistantResponse),
    extractText(input?.response),
    extractText(input?.output)
  ]);
  return buildNotificationPreview(source, CMUX_STOP_FALLBACK);
}

function cmuxSpawn(args) {
  if (!isCmuxEnabled()) {
    return;
  }
  try {
    const child = spawn("cmux", args, {
      stdio: "ignore",
      detached: true
    });
    child.on("error", () => {});
    child.unref();
  } catch {}
}

function cmuxSetStatus(input, sourceEvent, value, icon) {
  if (!shouldEmitCmuxEffect(input, `${sourceEvent}:set-status:${value}:${icon}`)) {
    return;
  }
  cmuxSpawn(["set-status", CMUX_STATUS_KEY, value, "--icon", icon, "--color", CMUX_STATUS_COLOR]);
}

function cmuxNotify(input, sourceEvent, body) {
  if (!shouldEmitCmuxEffect(input, `${sourceEvent}:notify:${body}`)) {
    return;
  }
  cmuxSpawn(["notify", "--title", "codex-nexus", "--body", body]);
}

function maybeSetRunning(input, sourceEvent) {
  if (isSubagentEvent(input)) {
    return;
  }
  cmuxSetStatus(input, sourceEvent, CMUX_RUNNING_VALUE, CMUX_RUNNING_ICON);
}

function maybeSetNeedsInput(input, sourceEvent, body) {
  if (isSubagentEvent(input)) {
    return;
  }
  cmuxNotify(input, sourceEvent, body);
  cmuxSetStatus(input, sourceEvent, CMUX_NEEDS_INPUT_VALUE, CMUX_NEEDS_INPUT_ICON);
}

function handleSessionStart(input) {
  ensureNexusLayout(input.cwd);
}

function handleUserPromptSubmit(input) {
  maybeSetRunning(input, "user-prompt-submit");

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

  maybeSetRunning(input, "pre-tool-use");
}

function handlePermissionRequest(input) {
  maybeSetNeedsInput(input, "permission-request", buildPermissionNotificationBody(input));
}

function handleStop(input) {
  maybeSetNeedsInput(input, "stop", buildStopNotificationBody(input));
  printJson({ continue: true });
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
    case "permission-request":
      handlePermissionRequest(input);
      return;
    case "stop":
      handleStop(input);
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
