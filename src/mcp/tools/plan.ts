import { existsSync, unlinkSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { textResult } from "../../shared/mcp-utils.js";
import { createNexusPaths, findProjectRoot, ensureDir } from "../../shared/paths.js";
import { readAgentTracker } from "../../shared/state.js";

export interface PlanIssue {
  id: number;
  title: string;
  status: "pending" | "decided";
  decision?: string;
  how_agents?: string[];
  how_summary?: Record<string, string>;
  how_agent_ids?: Record<string, string>;
}

export interface PlanFile {
  id: number;
  topic: string;
  issues: PlanIssue[];
  research_summary?: string;
  created_at: string;
}

function planFilePath() {
  const paths = createNexusPaths(findProjectRoot());
  return paths.PLAN_FILE;
}

export async function readPlan(): Promise<PlanFile | null> {
  const planPath = planFilePath();
  if (!existsSync(planPath)) return null;
  return JSON.parse(await readFile(planPath, "utf8")) as PlanFile;
}

async function writePlan(data: PlanFile): Promise<void> {
  const paths = createNexusPaths(findProjectRoot());
  await ensureDir(paths.STATE_ROOT);
  await writeFile(paths.PLAN_FILE, JSON.stringify(data, null, 2) + "\n", "utf8");
}

async function readHistoryFile(historyPath: string): Promise<{ cycles: Array<Record<string, unknown>> }> {
  if (!existsSync(historyPath)) return { cycles: [] };
  try {
    return JSON.parse(await readFile(historyPath, "utf8")) as { cycles: Array<Record<string, unknown>> };
  } catch {
    return { cycles: [] };
  }
}

async function nextPlanId(historyPath: string): Promise<number> {
  const history = await readHistoryFile(historyPath);
  let maxId = 0;
  for (const cycle of history.cycles) {
    const cyclePlan = cycle.plan as { id?: number } | undefined;
    if (typeof cyclePlan?.id === "number") {
      maxId = Math.max(maxId, cyclePlan.id);
    }
  }
  return maxId + 1;
}

function summarize(plan: PlanFile) {
  const total = plan.issues.length;
  const decided = plan.issues.filter((issue) => issue.status === "decided").length;
  return {
    total,
    decided,
    pending: total - decided
  };
}

function currentIssue(plan: PlanFile): PlanIssue | null {
  return plan.issues.find((issue) => issue.status === "pending") ?? null;
}

export function registerPlanTools(server: McpServer): void {
  server.tool(
    "nx_plan_start",
    "Start a plan session",
    {
      topic: z.string(),
      issues: z.array(z.string()),
      research_summary: z.string()
    },
    async ({ topic, issues, research_summary }) => {
      const paths = createNexusPaths(findProjectRoot());
      const existing = await readPlan();
      const history = await readHistoryFile(paths.HISTORY_FILE);
      if (existing) {
        history.cycles.push({
          completed_at: new Date().toISOString(),
          branch: "carry-over",
          plan: existing,
          tasks: []
        });
        await writeFile(paths.HISTORY_FILE, JSON.stringify(history, null, 2) + "\n", "utf8");
        unlinkSync(paths.PLAN_FILE);
      }

      const data: PlanFile = {
        id: await nextPlanId(paths.HISTORY_FILE),
        topic,
        issues: issues.map((issue, index) => ({
          id: index + 1,
          title: issue,
          status: "pending"
        })),
        research_summary,
        created_at: new Date().toISOString()
      };

      await writePlan(data);
      return textResult({
        created: true,
        plan_id: data.id,
        topic: data.topic,
        issueCount: data.issues.length
      });
    }
  );

  server.tool(
    "nx_plan_status",
    "Get current plan status",
    {},
    async () => {
      const paths = createNexusPaths(findProjectRoot());
      const plan = await readPlan();
      if (!plan) {
        return textResult({ active: false });
      }

      const tracker = await readAgentTracker(paths.AGENT_TRACKER_FILE);
      const followupReady = tracker.invocations
        .filter(
          (entry): entry is typeof entry & { agent_name: string } =>
            typeof entry.agent_name === "string" &&
            ["architect", "designer", "postdoc", "strategist"].includes(entry.agent_name)
        )
        .map((entry) => ({
          role: entry.agent_name,
          task_id: null,
          session_id: entry.agent_id ?? null,
          last_summary: entry.last_message ?? null
        }));

      return textResult({
        active: true,
        plan_id: plan.id,
        topic: plan.topic,
        issues: plan.issues,
        research_summary: plan.research_summary,
        summary: summarize(plan),
        current_issue: currentIssue(plan),
        followup_ready_roles: followupReady.filter((entry) => entry.session_id || entry.last_summary)
      });
    }
  );

  server.tool(
    "nx_plan_resume",
    "Get HOW participant resume routing info",
    {
      role: z.string(),
      question: z.string().optional()
    },
    async ({ role, question }) => {
      const paths = createNexusPaths(findProjectRoot());
      const tracker = await readAgentTracker(paths.AGENT_TRACKER_FILE);
      const participant = tracker.invocations.find((entry) => entry.agent_name === role) ?? null;
      if (!participant) {
        return textResult({
          role,
          resumable: false,
          recommendation: `No existing ${role} continuity found. Spawn a fresh ${role} participant if needed.`
        });
      }

      return textResult({
        role,
        resumable: Boolean(participant.agent_id),
        task_id: null,
        session_id: participant.agent_id ?? null,
        last_summary: participant.last_message ?? null,
        recommendation: participant.agent_id
          ? `Resume the existing ${role} participant and continue: ${question ?? "follow up on the current issue."}`
          : `Rehydrate a fresh ${role} participant from the last summary and continue: ${question ?? "follow up on the current issue."}`
      });
    }
  );

  server.tool(
    "nx_plan_followup",
    "Build delegation-ready HOW follow-up guidance",
    {
      role: z.string(),
      question: z.string(),
      issue_id: z.number().optional()
    },
    async ({ role, question, issue_id }) => {
      const paths = createNexusPaths(findProjectRoot());
      const tracker = await readAgentTracker(paths.AGENT_TRACKER_FILE);
      const plan = await readPlan();
      const participant = tracker.invocations.find((entry) => entry.agent_name === role) ?? null;
      const issue = issue_id && plan
        ? plan.issues.find((entry) => entry.id === issue_id) ?? null
        : plan ? currentIssue(plan) : null;

      return textResult({
        role,
        question,
        issue,
        delegation: {
          subagent_type: role,
          resume_task_id: null,
          resume_session_id: participant?.agent_id ?? null,
          prompt: participant?.agent_id
            ? `Resume the existing ${role} participant and continue this follow-up: ${question}`
            : `Spawn a ${role} participant and continue this follow-up: ${question}`,
          briefing_seed: participant?.last_message ?? null
        }
      });
    }
  );

  server.tool(
    "nx_plan_update",
    "Update plan issues",
    {
      action: z.enum(["add", "remove", "edit", "reopen"]),
      issue_id: z.number().optional(),
      title: z.string().optional()
    },
    async ({ action, issue_id, title }) => {
      const plan = await readPlan();
      if (!plan) return textResult({ error: "No active plan session" });

      if (action === "add") {
        if (!title) return textResult({ error: "title is required for add" });
        const nextId = plan.issues.reduce((max, issue) => Math.max(max, issue.id), 0) + 1;
        const issue = { id: nextId, title, status: "pending" as const };
        plan.issues.push(issue);
        await writePlan(plan);
        return textResult({ added: true, issue });
      }

      const issue = plan.issues.find((entry) => entry.id === issue_id);
      if (!issue) return textResult({ error: `Issue ${issue_id} not found` });

      if (action === "remove") {
        plan.issues = plan.issues.filter((entry) => entry.id !== issue_id);
        await writePlan(plan);
        return textResult({ removed: true, issue_id });
      }

      if (action === "edit") {
        if (!title) return textResult({ error: "title is required for edit" });
        issue.title = title;
        await writePlan(plan);
        return textResult({ edited: true, issue });
      }

      issue.status = "pending";
      delete issue.decision;
      await writePlan(plan);
      return textResult({ reopened: true, issue });
    }
  );

  server.tool(
    "nx_plan_decide",
    "Record a plan decision",
    {
      issue_id: z.number(),
      decision: z.string(),
      how_agents: z.array(z.string()).optional(),
      how_summary: z.record(z.string(), z.string()).optional(),
      how_agent_ids: z.record(z.string(), z.string()).optional()
    },
    async ({ issue_id, decision, how_agents, how_summary, how_agent_ids }) => {
      const plan = await readPlan();
      if (!plan) return textResult({ error: "No active plan session" });
      const issue = plan.issues.find((entry) => entry.id === issue_id);
      if (!issue) return textResult({ error: `Issue ${issue_id} not found` });

      issue.status = "decided";
      issue.decision = decision;
      if (how_agents) issue.how_agents = how_agents;
      if (how_summary) issue.how_summary = how_summary;
      if (how_agent_ids) issue.how_agent_ids = how_agent_ids;
      await writePlan(plan);

      return textResult({
        decided: true,
        issue: issue.title,
        allComplete: plan.issues.every((entry) => entry.status === "decided"),
        remaining: plan.issues.filter((entry) => entry.status !== "decided").map((entry) => entry.id)
      });
    }
  );
}
