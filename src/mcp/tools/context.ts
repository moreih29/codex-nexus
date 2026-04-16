import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { textResult } from "../../shared/mcp-utils.js";
import { createNexusPaths, findProjectRoot } from "../../shared/paths.js";
import { readTasksSummary } from "../../shared/tasks.js";
import { readPlan } from "./plan.js";

export function registerContextTool(server: McpServer): void {
  server.tool("nx_context", "Get current Nexus state", {}, async () => {
    const projectRoot = findProjectRoot();
    const paths = createNexusPaths(projectRoot);
    const tasks = await readTasksSummary(paths);
    const plan = await readPlan();
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
      active_tasks: tasks.exists ? tasks : null
    });
  });
}
