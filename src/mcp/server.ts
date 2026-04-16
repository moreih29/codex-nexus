import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { getCurrentVersion } from "../shared/version.js";
import { registerArtifactTools } from "./tools/artifact.js";
import { registerContextTool } from "./tools/context.js";
import { registerPlanTools } from "./tools/plan.js";
import { registerTaskTools } from "./tools/task.js";
import { registerWorkflowTools } from "./tools/workflow.js";

const server = new McpServer({
  name: "nx",
  version: getCurrentVersion()
});

registerContextTool(server);
registerPlanTools(server);
registerTaskTools(server);
registerArtifactTools(server);
registerWorkflowTools(server);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Nexus MCP server error:", error);
  process.exit(1);
});
