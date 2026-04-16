import { existsSync, unlinkSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { agentHasCapability } from "../../agents/definitions.js";
import { readSubagentSessionInfo, readTurnMetadataFromRequestMeta } from "../../shared/codex-session.js";
import { textErrorResult, textResult } from "../../shared/mcp-utils.js";
import { createNexusPaths, ensureDir, findProjectRoot } from "../../shared/paths.js";
import { readPlan, type PlanFile } from "./plan.js";
import type { TaskRecord, TasksFile } from "../../shared/tasks.js";

async function readTasks(): Promise<TasksFile | null> {
  const paths = createNexusPaths(findProjectRoot());
  if (!existsSync(paths.TASKS_FILE)) return null;
  return JSON.parse(await readFile(paths.TASKS_FILE, "utf8")) as TasksFile;
}

async function writeTasks(data: TasksFile): Promise<void> {
  const paths = createNexusPaths(findProjectRoot());
  await ensureDir(paths.STATE_ROOT);
  await writeFile(paths.TASKS_FILE, JSON.stringify(data, null, 2) + "\n", "utf8");
}

function summarize(tasks: TaskRecord[]) {
  const completedIds = new Set(tasks.filter((task) => task.status === "completed").map((task) => task.id));
  return {
    total: tasks.length,
    pending: tasks.filter((task) => task.status === "pending").length,
    in_progress: tasks.filter((task) => task.status === "in_progress").length,
    completed: tasks.filter((task) => task.status === "completed").length,
    ready: tasks
      .filter((task) => task.status === "pending" && task.deps.every((dep) => completedIds.has(dep)))
      .map((task) => task.id)
  };
}

async function appendHistoryCycle(plan: PlanFile | null, tasks: TaskRecord[]): Promise<number> {
  const paths = createNexusPaths(findProjectRoot());
  const history = existsSync(paths.HISTORY_FILE)
    ? JSON.parse(await readFile(paths.HISTORY_FILE, "utf8")) as { cycles: Array<Record<string, unknown>> }
    : { cycles: [] };

  history.cycles.push({
    completed_at: new Date().toISOString(),
    branch: "default",
    plan,
    tasks
  });

  await writeFile(paths.HISTORY_FILE, JSON.stringify(history, null, 2) + "\n", "utf8");
  return history.cycles.length;
}

export function getTaskCloseDeniedReason(requestMeta: unknown): string | null {
  const turnMetadata = readTurnMetadataFromRequestMeta(requestMeta);
  if (turnMetadata?.thread_source === "subagent") {
    return "Subagents cannot call nx_task_close. Delegate cycle closure to the lead session.";
  }
  return null;
}

export function getTaskAddDeniedReason(requestMeta: unknown): string | null {
  const turnMetadata = readTurnMetadataFromRequestMeta(requestMeta);
  if (turnMetadata?.thread_source === "subagent") {
    return "Subagents cannot call nx_task_add. The no_task_create capability requires delegating task creation to the lead session.";
  }
  return null;
}

export function getTaskUpdateDeniedReason(
  requestMeta: unknown,
  subagentRole: string | null
): string | null {
  const turnMetadata = readTurnMetadataFromRequestMeta(requestMeta);
  if (turnMetadata?.thread_source !== "subagent") return null;
  if (!subagentRole) return null;
  if (!agentHasCapability(subagentRole, "no_task_update")) return null;
  return `Subagent role "${subagentRole}" cannot call nx_task_update. The no_task_update capability requires delegating task status updates to the lead session.`;
}

async function readSubagentRoleFromRequestMeta(requestMeta: unknown): Promise<string | null> {
  const turnMetadata = readTurnMetadataFromRequestMeta(requestMeta);
  if (turnMetadata?.thread_source !== "subagent" || !turnMetadata.session_id) return null;
  try {
    const subagent = await readSubagentSessionInfo({ sessionId: turnMetadata.session_id });
    return subagent?.agentRole ?? null;
  } catch {
    return null;
  }
}

function taskMutationDeniedError(requestMeta: unknown, deniedReason: string, subagentRole?: string | null) {
  const turnMetadata = readTurnMetadataFromRequestMeta(requestMeta);
  return textErrorResult({
    error: deniedReason,
    session_id: turnMetadata?.session_id ?? null,
    thread_source: turnMetadata?.thread_source ?? null,
    agent_role: subagentRole ?? null
  });
}

export function registerTaskTools(server: McpServer): void {
  server.tool(
    "nx_task_list",
    "List current tasks",
    {},
    async () => {
      const data = await readTasks();
      if (!data) return textResult({ exists: false });
      return textResult({
        goal: data.goal,
        decisions: data.decisions,
        tasks: data.tasks,
        summary: summarize(data.tasks)
      });
    }
  );

  server.tool(
    "nx_task_add",
    "Add a task",
    {
      title: z.string(),
      context: z.string().default(""),
      deps: z.array(z.number()).default([]),
      approach: z.string().optional(),
      acceptance: z.string().optional(),
      risk: z.string().optional(),
      plan_issue: z.number().optional(),
      goal: z.string().optional(),
      decisions: z.array(z.string()).optional(),
      owner: z.string().optional(),
      owner_agent_id: z.string().optional(),
      owner_reuse_policy: z.enum(["fresh", "resume_if_same_artifact", "resume"]).optional()
    },
    async (input, extra) => {
      const deniedReason = getTaskAddDeniedReason(extra._meta);
      if (deniedReason) {
        return taskMutationDeniedError(extra._meta, deniedReason);
      }

      const data = (await readTasks()) ?? { goal: "", decisions: [], tasks: [] };
      if (input.goal) data.goal = input.goal;
      if (input.decisions) data.decisions = [...data.decisions, ...input.decisions];

      const nextId = data.tasks.reduce((max, task) => Math.max(max, task.id), 0) + 1;
      const task: TaskRecord = {
        id: nextId,
        title: input.title,
        context: input.context,
        deps: input.deps,
        approach: input.approach,
        acceptance: input.acceptance,
        risk: input.risk,
        plan_issue: input.plan_issue,
        owner: input.owner,
        owner_agent_id: input.owner_agent_id,
        owner_reuse_policy: input.owner_reuse_policy,
        status: "pending",
        created_at: new Date().toISOString()
      };

      data.tasks.push(task);
      await writeTasks(data);
      return textResult({ task });
    }
  );

  server.tool(
    "nx_task_update",
    "Update task status",
    {
      id: z.number(),
      status: z.enum(["pending", "in_progress", "completed"])
    },
    async ({ id, status }, extra) => {
      const subagentRole = await readSubagentRoleFromRequestMeta(extra._meta);
      const deniedReason = getTaskUpdateDeniedReason(extra._meta, subagentRole);
      if (deniedReason) {
        return taskMutationDeniedError(extra._meta, deniedReason, subagentRole);
      }

      const data = await readTasks();
      if (!data) return textResult({ error: "tasks.json not found" });
      const task = data.tasks.find((entry) => entry.id === id);
      if (!task) return textResult({ error: `Task ${id} not found` });
      task.status = status;
      await writeTasks(data);
      return textResult({ task });
    }
  );

  server.tool(
    "nx_task_close",
    "Archive the current cycle to history.json",
    {},
    async (_, extra) => {
      const deniedReason = getTaskCloseDeniedReason(extra._meta);
      if (deniedReason) {
        return taskMutationDeniedError(extra._meta, deniedReason);
      }

      const paths = createNexusPaths(findProjectRoot());
      const plan = await readPlan();
      const tasks = await readTasks();
      const count = await appendHistoryCycle(plan, tasks?.tasks ?? []);

      if (existsSync(paths.PLAN_FILE)) unlinkSync(paths.PLAN_FILE);
      if (existsSync(paths.TASKS_FILE)) unlinkSync(paths.TASKS_FILE);

      return textResult({
        closed: true,
        archived_cycles: count,
        deleted: ["plan.json", "tasks.json"].filter((name) =>
          name === "plan.json" ? !existsSync(paths.PLAN_FILE) : !existsSync(paths.TASKS_FILE)
        )
      });
    }
  );

  server.tool(
    "nx_history_search",
    "Search archived history",
    {
      query: z.string().optional(),
      last_n: z.number().optional()
    },
    async ({ query, last_n }) => {
      const paths = createNexusPaths(findProjectRoot());
      if (!existsSync(paths.HISTORY_FILE)) {
        return textResult({ total: 0, cycles: [] });
      }
      const history = JSON.parse(await readFile(paths.HISTORY_FILE, "utf8")) as { cycles: Array<Record<string, unknown>> };
      let cycles = history.cycles;
      if (query) {
        const needle = query.toLowerCase();
        cycles = cycles.filter((cycle) => JSON.stringify(cycle).toLowerCase().includes(needle));
      }
      const selected = cycles.slice(-(last_n ?? 10));
      return textResult({
        total: cycles.length,
        showing: selected.length,
        cycles: selected
      });
    }
  );
}
