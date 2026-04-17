import { describe, expect, test } from "bun:test";
import {
  resolvePlanContinuity,
  resolveRunTaskContinuity,
  type PlanLike
} from "../src/shared/continuity.js";
import type { AgentTrackerFile } from "../src/shared/state.js";
import type { TaskRecord } from "../src/shared/tasks.js";

function tracker(invocations: AgentTrackerFile["invocations"]): AgentTrackerFile {
  return { invocations };
}

describe("plan continuity", () => {
  test("prefers plan-recorded how_agent_ids over tracker fallback", () => {
    const plan: PlanLike = {
      id: 1,
      topic: "Resume test",
      issues: [
        {
          id: 2,
          title: "Architecture follow-up",
          status: "decided",
          how_agent_ids: {
            architect: "architect-from-plan"
          },
          how_summary: {
            architect: "Plan-recorded summary"
          }
        }
      ]
    };

    const result = resolvePlanContinuity({
      plan,
      tracker: tracker([
        {
          harness_id: "codex-nexus",
          agent_name: "architect",
          agent_id: "architect-from-tracker",
          started_at: "2026-04-17T00:00:00.000Z",
          status: "completed",
          stopped_at: "2026-04-17T00:05:00.000Z",
          last_message: "Tracker summary"
        }
      ]),
      role: "architect",
      issueId: 2
    });

    expect(result.resumable).toBe(true);
    expect(result.resume_agent_id).toBe("architect-from-plan");
    expect(result.source).toBe("plan_issue");
    expect(result.last_summary).toBe("Plan-recorded summary");
  });

  test("never resumes ephemeral roles", () => {
    const result = resolvePlanContinuity({
      plan: null,
      tracker: tracker([
        {
          harness_id: "codex-nexus",
          agent_name: "reviewer",
          agent_id: "reviewer-1",
          started_at: "2026-04-17T00:00:00.000Z",
          status: "completed",
          stopped_at: "2026-04-17T00:05:00.000Z"
        }
      ]),
      role: "reviewer"
    });

    expect(result.resumable).toBe(false);
    expect(result.resume_tier).toBe("ephemeral");
    expect(result.resume_agent_id).toBeNull();
  });
});

describe("run continuity", () => {
  test("persistent tasks fall back to the latest completed tracker entry", () => {
    const task: TaskRecord = {
      id: 7,
      title: "Research follow-up",
      context: "",
      owner: "researcher",
      deps: [],
      status: "pending"
    };

    const result = resolveRunTaskContinuity({
      task,
      tracker: tracker([
        {
          harness_id: "codex-nexus",
          agent_name: "researcher",
          agent_id: "researcher-old",
          started_at: "2026-04-17T00:00:00.000Z",
          status: "completed",
          stopped_at: "2026-04-17T00:05:00.000Z",
          last_message: "Most recent completed researcher"
        },
        {
          harness_id: "codex-nexus",
          agent_name: "researcher",
          agent_id: "researcher-running",
          started_at: "2026-04-17T00:10:00.000Z",
          status: "running"
        }
      ])
    });

    expect(result.resumable).toBe(true);
    expect(result.resume_agent_id).toBe("researcher-old");
    expect(result.source).toBe("tracker");
    expect(result.resume_tier).toBe("persistent");
  });

  test("bounded tasks require owner_agent_id when no explicit continuity is stored", () => {
    const task: TaskRecord = {
      id: 8,
      title: "Engineer follow-up",
      context: "",
      owner: "engineer",
      deps: [],
      status: "pending"
    };

    const result = resolveRunTaskContinuity({
      task,
      tracker: tracker([])
    });

    expect(result.resumable).toBe(false);
    expect(result.resume_tier).toBe("bounded");
    expect(result.reason).toContain("owner_agent_id");
  });

  test("bounded tasks block resume after overlapping later edits by another agent", () => {
    const task: TaskRecord = {
      id: 9,
      title: "Bounded overlap",
      context: "",
      owner: "engineer",
      owner_agent_id: "engineer-1",
      deps: [],
      status: "in_progress"
    };

    const result = resolveRunTaskContinuity({
      task,
      tracker: tracker([
        {
          harness_id: "codex-nexus",
          agent_name: "engineer",
          agent_id: "engineer-1",
          started_at: "2026-04-17T00:00:00.000Z",
          status: "completed",
          stopped_at: "2026-04-17T00:05:00.000Z",
          files_touched: ["src/feature.ts"]
        },
        {
          harness_id: "codex-nexus",
          agent_name: "writer",
          agent_id: "writer-1",
          started_at: "2026-04-17T00:06:00.000Z",
          status: "completed",
          stopped_at: "2026-04-17T00:10:00.000Z",
          files_touched: ["src/feature.ts"]
        }
      ])
    });

    expect(result.resumable).toBe(false);
    expect(result.reason).toContain("later modified by another agent");
  });
});
