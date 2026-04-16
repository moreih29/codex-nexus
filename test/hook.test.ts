import { describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import path from "node:path";

function runHook(payload: Record<string, unknown>): Promise<string> {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(process.cwd(), "dist", "hooks", "codex-native-hook.js");
    const child = spawn("bun", [scriptPath], {
      cwd: process.cwd(),
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0 && !stdout.trim()) {
        reject(new Error(stderr || `hook exited with ${code}`));
      } else {
        resolve(stdout.trim());
      }
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

describe("codex-native-hook", () => {
  test("routes [plan] prompt to nx-plan guidance", async () => {
    const raw = await runHook({
      hook_event_name: "UserPromptSubmit",
      prompt: "[plan] design the auth flow"
    });
    const parsed = JSON.parse(raw) as { hookSpecificOutput?: { additionalContext?: string } };
    expect(parsed.hookSpecificOutput?.additionalContext).toContain("$nx-plan");
  });
});
