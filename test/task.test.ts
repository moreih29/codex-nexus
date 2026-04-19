import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import {
  closeCycleFiles,
  getTaskAddDeniedReason,
  getTaskCloseDeniedReason,
  getTaskUpdateDeniedReason
} from "../src/mcp/tools/task.js";
import { createNexusPaths } from "../src/shared/paths.js";

describe("nx_task_close guard", () => {
  test("blocks subagent callers from closing task cycles", () => {
    const meta = {
      "x-codex-turn-metadata": {
        session_id: "subagent-session",
        thread_source: "subagent",
        turn_id: "turn-1"
      }
    };

    expect(getTaskCloseDeniedReason(meta)).toBe(
      "Subagents cannot call nx_task_close. Delegate cycle closure to the lead session."
    );
  });

  test("allows lead callers to close task cycles", () => {
    const meta = {
      "x-codex-turn-metadata": {
        session_id: "lead-session",
        thread_source: "user",
        turn_id: "turn-1"
      }
    };

    expect(getTaskCloseDeniedReason(meta)).toBeNull();
  });

  test("parses JSON-string request metadata", () => {
    const meta = {
      "x-codex-turn-metadata": JSON.stringify({
        session_id: "subagent-session",
        thread_source: "subagent",
        turn_id: "turn-2"
      })
    };

    expect(getTaskCloseDeniedReason(meta)).toBe(
      "Subagents cannot call nx_task_close. Delegate cycle closure to the lead session."
    );
  });
});

describe("task mutation guards", () => {
  const subagentMeta = {
    "x-codex-turn-metadata": {
      session_id: "subagent-session",
      thread_source: "subagent",
      turn_id: "turn-3"
    }
  };

  const leadMeta = {
    "x-codex-turn-metadata": {
      session_id: "lead-session",
      thread_source: "user",
      turn_id: "turn-3"
    }
  };

  test("blocks subagent callers from creating tasks", () => {
    expect(getTaskAddDeniedReason(subagentMeta)).toBe(
      "Subagents cannot call nx_task_add. The no_task_create capability requires delegating task creation to the lead session."
    );
    expect(getTaskAddDeniedReason(leadMeta)).toBeNull();
  });

  test("blocks no_task_update roles from updating tasks", () => {
    expect(getTaskUpdateDeniedReason(subagentMeta, "architect")).toBe(
      'Subagent role "architect" cannot call nx_task_update. The no_task_update capability requires delegating task status updates to the lead session.'
    );
  });

  test("allows roles without no_task_update capability to update tasks", () => {
    expect(getTaskUpdateDeniedReason(subagentMeta, "engineer")).toBeNull();
    expect(getTaskUpdateDeniedReason(subagentMeta, "reviewer")).toBeNull();
    expect(getTaskUpdateDeniedReason(subagentMeta, null)).toBeNull();
    expect(getTaskUpdateDeniedReason(leadMeta, "architect")).toBeNull();
  });
});

describe("closeCycleFiles", () => {
  test("removes plan/tasks files and clears the run-session marker", async () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), "codex-nexus-close-cycle-"));
    try {
      const paths = createNexusPaths(tempDir);
      mkdirSync(paths.HARNESS_STATE_ROOT, { recursive: true });
      mkdirSync(paths.STATE_ROOT, { recursive: true });
      writeFileSync(paths.PLAN_FILE, "{}\n", "utf8");
      writeFileSync(paths.TASKS_FILE, "{}\n", "utf8");
      writeFileSync(paths.RUN_SESSION_FILE, "{\"active\":true}\n", "utf8");

      await closeCycleFiles(paths);

      expect(existsSync(paths.PLAN_FILE)).toBe(false);
      expect(existsSync(paths.TASKS_FILE)).toBe(false);
      expect(existsSync(paths.RUN_SESSION_FILE)).toBe(false);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
