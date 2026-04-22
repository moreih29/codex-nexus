import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = path.resolve(import.meta.dir, "..");
const hookScript = path.join(repoRoot, "scripts", "codex-nexus-hook.mjs");

function runHook(mode, payload, cwd) {
  return spawnSync(process.execPath, [hookScript, mode], {
    cwd,
    input: JSON.stringify(payload),
    encoding: "utf8"
  });
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
