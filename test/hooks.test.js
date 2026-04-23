import { expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = path.resolve(import.meta.dir, "..");
const hookScript = path.join(repoRoot, "scripts", "codex-nexus-hook.mjs");
const CMUX_RUNNING_ICON = "oct-zap";
const CMUX_NEEDS_INPUT_ICON = "bell.fill";

function runHook(mode, payload, cwd, env = process.env) {
  return spawnSync(process.execPath, [hookScript, mode], {
    cwd,
    env,
    input: JSON.stringify(payload),
    encoding: "utf8"
  });
}

function writeFakeCmux(binDir, logPath) {
  const cmuxPath = path.join(binDir, "cmux");
  writeFileSync(
    cmuxPath,
    `#!/usr/bin/env node\nconst fs = require(\"node:fs\");\nfs.appendFileSync(process.env.CMUX_TEST_LOG, JSON.stringify(process.argv.slice(2)) + \"\\n\");\n`,
    "utf8"
  );
  chmodSync(cmuxPath, 0o755);
}

function buildCmuxEnv(binDir, logPath, workspaceId) {
  return {
    ...process.env,
    PATH: `${binDir}:${process.env.PATH}`,
    CMUX_WORKSPACE_ID: workspaceId,
    CMUX_TEST_LOG: logPath
  };
}

async function waitForLogEntries(logPath, expectedCount) {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    const entries = readLogEntries(logPath);
    if (entries.length >= expectedCount) {
      return entries;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return readLogEntries(logPath);
}

function readLogEntries(logPath) {
  if (!existsSync(logPath)) {
    return [];
  }
  return readFileSync(logPath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function findNotifyBodies(entries) {
  return entries
    .filter((entry) => entry[0] === "notify")
    .map((entry) => {
      const bodyIndex = entry.indexOf("--body");
      return bodyIndex >= 0 ? entry[bodyIndex + 1] : null;
    })
    .filter((value) => typeof value === "string");
}

test("session-start creates the nexus directory layout", () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "codex-nexus-hook-"));

  try {
    const result = runHook(
      "session-start",
      {
        cwd,
        hookEventName: "SessionStart",
        source: "startup"
      },
      cwd
    );

    expect(result.status).toBe(0);
    expect(existsSync(path.join(cwd, ".nexus", "context"))).toBe(true);
    expect(existsSync(path.join(cwd, ".nexus", "memory"))).toBe(true);
    expect(readFileSync(path.join(cwd, ".nexus", ".gitignore"), "utf8")).toContain("!history.json");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("user-prompt-submit injects nexus tag routing context", () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "codex-nexus-hook-"));

  try {
    const result = runHook(
      "user-prompt-submit",
      {
        cwd,
        prompt: "[plan] design the auth flow"
      },
      cwd
    );

    expect(result.status).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(payload.systemMessage).toBe("Nexus tag detected: [plan]");
    expect(payload.hookSpecificOutput.hookEventName).toBe("UserPromptSubmit");
    expect(payload.hookSpecificOutput.additionalContext).toContain("Activate the nx-plan skill.");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("pre-tool-use denies blocked git commands", () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "codex-nexus-hook-"));

  try {
    const result = runHook(
      "pre-tool-use",
      {
        cwd,
        toolName: "Bash",
        toolInput: {
          command: "git add -A"
        }
      },
      cwd
    );

    expect(result.status).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(payload.hookSpecificOutput.hookEventName).toBe("PreToolUse");
    expect(payload.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(payload.hookSpecificOutput.permissionDecisionReason).toContain("explicit git add paths");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("user-prompt-submit sets a cmux Running status when cmux integration is enabled", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "codex-nexus-hook-"));
  const binDir = mkdtempSync(path.join(tmpdir(), "codex-nexus-hook-bin-"));
  const logPath = path.join(cwd, "cmux.log");

  try {
    writeFakeCmux(binDir, logPath);
    const env = buildCmuxEnv(binDir, logPath, path.basename(cwd));

    const result = runHook(
      "user-prompt-submit",
      {
        cwd,
        prompt: "hello"
      },
      cwd,
      env
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
    const entries = await waitForLogEntries(logPath, 1);
    expect(entries).toContainEqual(["set-status", "nexus-state", "Running", "--icon", CMUX_RUNNING_ICON, "--color", "#007AFF"]);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(binDir, { recursive: true, force: true });
  }
});

test("permission-request sends a cmux notification and Needs Input status", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "codex-nexus-hook-"));
  const binDir = mkdtempSync(path.join(tmpdir(), "codex-nexus-hook-bin-"));
  const logPath = path.join(cwd, "cmux.log");

  try {
    writeFakeCmux(binDir, logPath);
    const env = buildCmuxEnv(binDir, logPath, path.basename(cwd));

    const result = runHook(
      "permission-request",
      {
        cwd,
        tool_name: "Bash",
        tool_input: {
          command: "npm test",
          description: "Need approval"
        }
      },
      cwd,
      env
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
    const entries = await waitForLogEntries(logPath, 2);
    expect(entries).toContainEqual(["notify", "--title", "codex-nexus", "--body", "Need approval"]);
    expect(entries).toContainEqual(["set-status", "nexus-state", "Needs Input", "--icon", CMUX_NEEDS_INPUT_ICON, "--color", "#007AFF"]);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(binDir, { recursive: true, force: true });
  }
});

test("stop sends a cmux notification and returns JSON continue output", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "codex-nexus-hook-"));
  const binDir = mkdtempSync(path.join(tmpdir(), "codex-nexus-hook-bin-"));
  const logPath = path.join(cwd, "cmux.log");

  try {
    writeFakeCmux(binDir, logPath);
    const env = buildCmuxEnv(binDir, logPath, path.basename(cwd));

    const result = runHook(
      "stop",
      {
        cwd,
        turn_id: "turn-1",
        last_assistant_message: "Done"
      },
      cwd,
      env
    );

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ continue: true });
    const entries = await waitForLogEntries(logPath, 2);
    expect(entries).toContainEqual(["notify", "--title", "codex-nexus", "--body", "Done"]);
    expect(entries).toContainEqual(["set-status", "nexus-state", "Needs Input", "--icon", CMUX_NEEDS_INPUT_ICON, "--color", "#007AFF"]);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(binDir, { recursive: true, force: true });
  }
});

test("stop notification preview skips leading [Pre-check] and truncates long assistant output", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "codex-nexus-hook-"));
  const binDir = mkdtempSync(path.join(tmpdir(), "codex-nexus-hook-bin-"));
  const logPath = path.join(cwd, "cmux.log");

  try {
    writeFakeCmux(binDir, logPath);
    const env = buildCmuxEnv(binDir, logPath, path.basename(cwd));
    const longAssistantMessage = `[Pre-check]

- First impression / evidence level: verified
- Action: respond now

Deployment succeeded for every region and the canary checks are stable with no retries needed across the fleet overnight.`;

    const result = runHook(
      "stop",
      {
        cwd,
        turn_id: "turn-1",
        last_assistant_message: longAssistantMessage
      },
      cwd,
      env
    );

    expect(result.status).toBe(0);
    const entries = await waitForLogEntries(logPath, 2);
    const [notifyBody] = findNotifyBodies(entries);
    expect(notifyBody).toBeDefined();
    expect(notifyBody).not.toContain("[Pre-check]");
    expect(notifyBody).toStartWith("Deployment succeeded for every region");
    expect(notifyBody).toEndWith("…");
    expect(Array.from(notifyBody).length).toBeLessThanOrEqual(96);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(binDir, { recursive: true, force: true });
  }
});

test("duplicate back-to-back permission-request hook events are suppressed", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "codex-nexus-hook-"));
  const binDir = mkdtempSync(path.join(tmpdir(), "codex-nexus-hook-bin-"));
  const logPath = path.join(cwd, "cmux.log");

  try {
    writeFakeCmux(binDir, logPath);
    const env = buildCmuxEnv(binDir, logPath, path.basename(cwd));
    const payload = {
      cwd,
      tool_name: "Bash",
      tool_input: {
        command: "npm test",
        description: "Need approval"
      }
    };

    const first = runHook("permission-request", payload, cwd, env);
    const second = runHook("permission-request", payload, cwd, env);
    expect(first.status).toBe(0);
    expect(second.status).toBe(0);

    await waitForLogEntries(logPath, 2);
    await new Promise((resolve) => setTimeout(resolve, 200));
    const finalEntries = readLogEntries(logPath);
    expect(finalEntries).toHaveLength(2);
    expect(finalEntries).toContainEqual(["notify", "--title", "codex-nexus", "--body", "Need approval"]);
    expect(finalEntries).toContainEqual([
      "set-status",
      "nexus-state",
      "Needs Input",
      "--icon",
      CMUX_NEEDS_INPUT_ICON,
      "--color",
      "#007AFF"
    ]);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(binDir, { recursive: true, force: true });
  }
});

test("cmux integration can be disabled with CODEX_NEXUS_CMUX=0", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "codex-nexus-hook-"));
  const binDir = mkdtempSync(path.join(tmpdir(), "codex-nexus-hook-bin-"));
  const logPath = path.join(cwd, "cmux.log");

  try {
    writeFakeCmux(binDir, logPath);
    const env = {
      ...buildCmuxEnv(binDir, logPath, path.basename(cwd)),
      CODEX_NEXUS_CMUX: "0"
    };

    const result = runHook(
      "stop",
      {
        cwd,
        turn_id: "turn-1"
      },
      cwd,
      env
    );

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ continue: true });
    const entries = await waitForLogEntries(logPath, 1);
    expect(entries).toHaveLength(0);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(binDir, { recursive: true, force: true });
  }
});
