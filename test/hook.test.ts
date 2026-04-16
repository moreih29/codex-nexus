import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { tmpdir } from "node:os";
import { z } from "zod";

function runHookProcess(input: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
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
      resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() });
    });
    child.stdin.end(input);
  });
}

async function runHook(payload: Record<string, unknown>): Promise<string> {
  const result = await runHookProcess(JSON.stringify(payload));
  if (result.code !== 0) {
    throw new Error(result.stderr || `hook exited with ${result.code}`);
  }
  return result.stdout;
}

async function writeSubagentTranscript(config: {
  dir: string;
  sessionId: string;
  parentSessionId: string;
  nickname: string;
  role: string;
  touchedPaths?: string[];
}): Promise<string> {
  const transcriptPath = path.join(config.dir, `${config.sessionId}.jsonl`);
  const sessionMetaLine = JSON.stringify({
    timestamp: "2026-04-16T12:00:00.000Z",
    type: "session_meta",
    payload: {
      id: config.sessionId,
      cwd: config.dir,
      source: {
        subagent: {
          thread_spawn: {
            parent_thread_id: config.parentSessionId,
            depth: 1,
            agent_path: `${config.role}/1`,
            agent_nickname: config.nickname,
            agent_role: config.role
          }
        }
      },
      agent_nickname: config.nickname,
      agent_role: config.role
    }
  });

  const lines = [sessionMetaLine];
  if (config.touchedPaths && config.touchedPaths.length > 0) {
    const changes = Object.fromEntries(
      config.touchedPaths.map((filePath) => [
        filePath,
        {
          type: "update",
          unified_diff: "@@ -1 +1 @@",
          move_path: null
        }
      ])
    );
    lines.push(JSON.stringify({
      timestamp: "2026-04-16T12:00:05.000Z",
      type: "event_msg",
      payload: {
        type: "patch_apply_end",
        call_id: "apply-patch-1",
        success: true,
        status: "completed",
        changes
      }
    }));
  }

  await Bun.write(transcriptPath, `${lines.join("\n")}\n`);
  return transcriptPath;
}

const hookUniversalSchema = z.object({
  continue: z.boolean().optional(),
  stopReason: z.string().optional(),
  suppressOutput: z.boolean().optional(),
  systemMessage: z.string().optional()
});

const sessionStartOutputSchema = hookUniversalSchema.extend({
  hookSpecificOutput: z.object({
    hookEventName: z.literal("SessionStart"),
    additionalContext: z.string().optional()
  }).strict().optional()
}).strict();

const userPromptSubmitOutputSchema = hookUniversalSchema.extend({
  decision: z.literal("block").optional(),
  reason: z.string().optional(),
  hookSpecificOutput: z.object({
    hookEventName: z.literal("UserPromptSubmit"),
    additionalContext: z.string().optional()
  }).strict().optional()
}).strict().superRefine((value, ctx) => {
  if (value.decision === "block" && (!value.reason || value.reason.trim().length === 0)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "reason is required when decision=block"
    });
  }
});

describe("codex-native-hook", () => {
  test("emits valid SessionStart hook output and bootstraps nexus state", async () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), "codex-nexus-hook-"));
    try {
      const raw = await runHook({
        hook_event_name: "SessionStart",
        cwd: tempDir
      });
      const parsed = sessionStartOutputSchema.parse(JSON.parse(raw));

      expect(parsed.hookSpecificOutput?.additionalContext).toContain("Codex Nexus is active");
      expect(existsSync(path.join(tempDir, ".nexus", "history.json"))).toBe(true);
      expect(JSON.parse(readFileSync(path.join(tempDir, ".nexus", "history.json"), "utf8"))).toEqual({
        cycles: []
      });
      expect(
        JSON.parse(readFileSync(path.join(tempDir, ".nexus", "state", "codex-nexus", "agent-tracker.json"), "utf8"))
      ).toEqual([]);
      expect(readFileSync(path.join(tempDir, ".nexus", "state", "tool-log.jsonl"), "utf8")).toBe("");
      expect(existsSync(path.join(tempDir, ".gitignore"))).toBe(true);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("recreates session-scoped tracker and tool-log on each SessionStart", async () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), "codex-nexus-hook-reset-"));
    try {
      const trackerPath = path.join(tempDir, ".nexus", "state", "codex-nexus", "agent-tracker.json");
      const toolLogPath = path.join(tempDir, ".nexus", "state", "tool-log.jsonl");

      await runHook({
        hook_event_name: "SessionStart",
        cwd: tempDir
      });

      await Bun.write(trackerPath, `${JSON.stringify([{ agent_name: "stale-agent" }], null, 2)}\n`);
      await Bun.write(toolLogPath, "{\"stale\":true}\n");

      await runHook({
        hook_event_name: "SessionStart",
        cwd: tempDir
      });

      expect(JSON.parse(readFileSync(trackerPath, "utf8"))).toEqual([]);
      expect(readFileSync(toolLogPath, "utf8")).toBe("");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("records subagent sessions in agent-tracker on SessionStart", async () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), "codex-nexus-hook-subagent-"));
    try {
      const sessionId = "subagent-session-1";
      const transcriptPath = await writeSubagentTranscript({
        dir: tempDir,
        sessionId,
        parentSessionId: "parent-session-1",
        nickname: "Russell",
        role: "researcher"
      });

      await runHook({
        hook_event_name: "SessionStart",
        cwd: tempDir,
        session_id: sessionId,
        transcript_path: transcriptPath
      });

      const tracker = JSON.parse(
        readFileSync(path.join(tempDir, ".nexus", "state", "codex-nexus", "agent-tracker.json"), "utf8")
      ) as Array<Record<string, unknown>>;

      expect(tracker).toHaveLength(1);
      expect(tracker[0]).toMatchObject({
        agent_name: "researcher",
        agent_id: sessionId,
        session_id: sessionId,
        parent_session_id: "parent-session-1",
        agent_nickname: "Russell",
        agent_path: "researcher/1",
        status: "started",
        source: "subagent_thread_spawn"
      });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("subagent SessionStart does not reset existing session-scoped state", async () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), "codex-nexus-hook-subagent-reset-"));
    try {
      const trackerPath = path.join(tempDir, ".nexus", "state", "codex-nexus", "agent-tracker.json");
      const toolLogPath = path.join(tempDir, ".nexus", "state", "tool-log.jsonl");

      await runHook({
        hook_event_name: "SessionStart",
        cwd: tempDir
      });

      await Bun.write(trackerPath, `${JSON.stringify([{ agent_name: "existing-agent" }], null, 2)}\n`);
      await Bun.write(toolLogPath, "{\"ts\":\"2026-04-16T12:00:01.000Z\",\"tool_name\":\"apply_patch\",\"path\":\"/tmp/existing.txt\"}\n");

      const sessionId = "subagent-session-2";
      const transcriptPath = await writeSubagentTranscript({
        dir: tempDir,
        sessionId,
        parentSessionId: "parent-session-2",
        nickname: "Singer",
        role: "researcher"
      });

      await runHook({
        hook_event_name: "SessionStart",
        cwd: tempDir,
        session_id: sessionId,
        transcript_path: transcriptPath
      });

      const tracker = JSON.parse(readFileSync(trackerPath, "utf8")) as Array<Record<string, unknown>>;
      expect(tracker).toHaveLength(2);
      expect(tracker[0]).toMatchObject({ agent_name: "existing-agent" });
      expect(tracker[1]).toMatchObject({
        agent_name: "researcher",
        session_id: sessionId,
        status: "started"
      });
      expect(readFileSync(toolLogPath, "utf8")).toContain("/tmp/existing.txt");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("subagent Stop records files_touched and tool-log entries without deleting tracker", async () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), "codex-nexus-hook-subagent-stop-"));
    try {
      const trackerPath = path.join(tempDir, ".nexus", "state", "codex-nexus", "agent-tracker.json");
      const toolLogPath = path.join(tempDir, ".nexus", "state", "tool-log.jsonl");
      const touchedPaths = [
        path.join(tempDir, "src", "alpha.ts"),
        path.join(tempDir, "src", "beta.ts")
      ];
      const sessionId = "subagent-session-3";

      await runHook({
        hook_event_name: "SessionStart",
        cwd: tempDir
      });

      const transcriptPath = await writeSubagentTranscript({
        dir: tempDir,
        sessionId,
        parentSessionId: "parent-session-3",
        nickname: "Tess",
        role: "researcher",
        touchedPaths
      });

      await runHook({
        hook_event_name: "SessionStart",
        cwd: tempDir,
        session_id: sessionId,
        transcript_path: transcriptPath
      });

      const result = await runHookProcess(JSON.stringify({
        hook_event_name: "Stop",
        cwd: tempDir,
        session_id: sessionId,
        transcript_path: transcriptPath
      }));

      expect(result.code).toBe(0);
      expect(result.stdout).toBe("");
      expect(existsSync(trackerPath)).toBe(true);

      const tracker = JSON.parse(readFileSync(trackerPath, "utf8")) as Array<Record<string, unknown>>;
      expect(tracker).toHaveLength(1);
      expect(tracker[0]).toMatchObject({
        agent_name: "researcher",
        session_id: sessionId,
        status: "completed"
      });
      const filesTouched = Array.isArray(tracker[0].files_touched)
        ? tracker[0].files_touched as string[]
        : [];
      expect([...filesTouched].sort()).toEqual([...touchedPaths].sort());

      const toolLogEntries = readFileSync(toolLogPath, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as Record<string, unknown>);
      expect(toolLogEntries).toHaveLength(2);
      expect(toolLogEntries[0]).toMatchObject({
        session_id: sessionId,
        tool_name: "apply_patch",
        status: "completed"
      });
      expect(toolLogEntries.map((entry) => entry.path).sort()).toEqual([...touchedPaths].sort());
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("lead Stop removes agent-tracker on clean exit", async () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), "codex-nexus-hook-lead-stop-"));
    try {
      await runHook({
        hook_event_name: "SessionStart",
        cwd: tempDir
      });

      const result = await runHookProcess(JSON.stringify({
        hook_event_name: "Stop",
        cwd: tempDir
      }));

      expect(result.code).toBe(0);
      expect(result.stdout).toBe("");
      expect(existsSync(path.join(tempDir, ".nexus", "state", "codex-nexus", "agent-tracker.json"))).toBe(false);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("does not log plain Bash activity to tool-log", async () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), "codex-nexus-hook-bash-log-"));
    try {
      const toolLogPath = path.join(tempDir, ".nexus", "state", "tool-log.jsonl");

      await runHook({
        hook_event_name: "SessionStart",
        cwd: tempDir
      });

      const result = await runHookProcess(JSON.stringify({
        hook_event_name: "PostToolUse",
        cwd: tempDir,
        tool_name: "Bash",
        tool_input: { command: "pwd" },
        tool_response: {
          exit_code: 0,
          stdout: tempDir,
          stderr: ""
        }
      }));

      expect(result.code).toBe(0);
      expect(result.stdout).toBe("");
      expect(readFileSync(toolLogPath, "utf8")).toBe("");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("routes [plan] prompt to nx-plan guidance with valid UserPromptSubmit output", async () => {
    const raw = await runHook({
      hook_event_name: "UserPromptSubmit",
      prompt: "[plan] design the auth flow"
    });
    const parsed = userPromptSubmitOutputSchema.parse(JSON.parse(raw));

    expect(parsed.hookSpecificOutput?.additionalContext).toContain("$nx-plan");
  });

  test("returns no output for unrelated prompts", async () => {
    const result = await runHookProcess(JSON.stringify({
      hook_event_name: "UserPromptSubmit",
      prompt: "hello there"
    }));

    expect(result.code).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
  });

  test("writes failures to stderr instead of invalid JSON stdout", async () => {
    const result = await runHookProcess("{");

    expect(result.code).not.toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr.length).toBeGreaterThan(0);
  });
});
