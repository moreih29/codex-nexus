import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolvePlanContinuity, resolveRunTaskContinuity } from "../../shared/continuity.js";
import { textResult } from "../../shared/mcp-utils.js";
import { createNexusPaths, findProjectRoot } from "../../shared/paths.js";
import { readAgentTracker } from "../../shared/state.js";
import { readTasks, readTasksSummary } from "../../shared/tasks.js";
import { readPlan } from "./plan.js";

const HOW_ROLES = ["architect", "designer", "postdoc", "strategist"] as const;

export function registerContextTool(server: McpServer): void {
  server.tool("nx_context", "Get current Nexus state", {}, async () => {
    const projectRoot = findProjectRoot();
    const paths = createNexusPaths(projectRoot);
    const [tasks, taskFile, plan, tracker] = await Promise.all([
      readTasksSummary(paths),
      readTasks(paths),
      readPlan(),
      readAgentTracker(paths.AGENT_TRACKER_FILE)
    ]);

    const planFollowups = plan
      ? HOW_ROLES
          .map((role) => resolvePlanContinuity({ plan, tracker, role }))
          .filter((entry) => entry.resumable || entry.last_summary)
          .map((entry) => ({
            role: entry.role,
            resume_tier: entry.resume_tier,
            resumable: entry.resumable,
            agent_id: entry.resume_agent_id,
            source: entry.source,
            reason: entry.reason
          }))
      : [];

    const runResumeCandidates = taskFile
      ? taskFile.tasks
          .filter((task) => task.status !== "completed" && typeof task.owner === "string" && task.owner !== "lead")
          .map((task) => resolveRunTaskContinuity({ task, tracker }))
          .map((entry) => ({
            task_id: entry.task_id,
            owner: entry.owner,
            resume_tier: entry.resume_tier,
            reuse_policy: entry.reuse_policy,
            resumable: entry.resumable,
            agent_id: entry.resume_agent_id,
            source: entry.source,
            reason: entry.reason
          }))
      : [];

    return textResult({
      project_root: projectRoot,
      active_plan: plan
        ? {
            id: plan.id,
            topic: plan.topic,
            summary: {
              total: plan.issues.length,
              pending: plan.issues.filter((issue) => issue.status === "pending").length,
              decided: plan.issues.filter((issue) => issue.status === "decided").length
            }
          }
        : null,
      plan_followup_ready_roles: planFollowups,
      active_tasks: tasks.exists ? tasks : null,
      run_resume_candidates: runResumeCandidates
    });
  });
}
