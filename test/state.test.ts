import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { upsertAgentTrackerEntry } from "../src/shared/state.js";

describe("agent tracker upsert", () => {
  test("preserves fresh sessions for the same role and only increments resume metadata for the same agent id", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "codex-nexus-state-"));
    const trackerPath = path.join(dir, "agent-tracker.json");

    try {
      await upsertAgentTrackerEntry(trackerPath, {
        harness_id: "codex-nexus",
        agent_name: "architect",
        agent_id: "architect-1",
        started_at: "2026-04-17T00:00:00.000Z",
        status: "completed",
        stopped_at: "2026-04-17T00:05:00.000Z"
      });

      await upsertAgentTrackerEntry(trackerPath, {
        harness_id: "codex-nexus",
        agent_name: "architect",
        agent_id: "architect-2",
        started_at: "2026-04-17T00:06:00.000Z",
        status: "running"
      });

      await upsertAgentTrackerEntry(trackerPath, {
        harness_id: "codex-nexus",
        agent_name: "architect",
        agent_id: "architect-1",
        started_at: "2026-04-17T00:07:00.000Z",
        status: "running"
      });

      const tracker = JSON.parse(readFileSync(trackerPath, "utf8")) as Array<Record<string, unknown>>;

      expect(tracker).toHaveLength(2);
      const original = tracker.find((entry) => entry.agent_id === "architect-1");
      const fresh = tracker.find((entry) => entry.agent_id === "architect-2");

      expect(original?.resume_count).toBe(1);
      expect(typeof original?.last_resumed_at).toBe("string");
      expect(fresh?.resume_count ?? 0).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
