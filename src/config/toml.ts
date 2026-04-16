import TOML from "@iarna/toml";
import path from "node:path";

function safeObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function mergeConfigToml(existingContent: string | null, packageRoot: string): string {
  const parsed = existingContent ? TOML.parse(existingContent) as Record<string, unknown> : {};
  const features = safeObject(parsed.features);
  const mcpServers = safeObject(parsed.mcp_servers);

  parsed.features = {
    ...features,
    multi_agent: true,
    child_agents_md: true,
    codex_hooks: true
  };

  parsed.developer_instructions = [
    "Nexus is installed.",
    "Use AGENTS.md as the primary orchestration surface.",
    "Use workflow skills via $nx-plan, $nx-run, $nx-init, and $nx-sync when routed by tags or user request.",
    "Use the nx MCP server for stateful plan, task, onboarding, and sync workflows.",
    "Installed native subagents live under .codex/agents and are available for bounded delegation."
  ].join(" ");

  mcpServers.nx = {
    command: "bun",
    args: [path.join(packageRoot, "dist", "mcp", "server.js")]
  };
  parsed.mcp_servers = mcpServers;

  return TOML.stringify(parsed as TOML.JsonMap);
}
