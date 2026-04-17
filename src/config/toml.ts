import TOML from "@iarna/toml";
import path from "node:path";

const CONTEXT7_URL = "https://mcp.context7.com/mcp";
const CONTEXT7_BEARER_TOKEN_ENV_VAR = "CONTEXT7_API_KEY";

export interface ManagedConfigOptions {
  coreOnly?: boolean;
}

function safeObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function isManagedContext7Server(value: unknown): boolean {
  const record = safeObject(value);
  const keys = Object.keys(record);
  return keys.length === 2 &&
    keys.includes("url") &&
    keys.includes("bearer_token_env_var") &&
    record.url === CONTEXT7_URL &&
    record.bearer_token_env_var === CONTEXT7_BEARER_TOKEN_ENV_VAR;
}

export function mergeConfigToml(
  existingContent: string | null,
  packageRoot: string,
  options: ManagedConfigOptions = {}
): string {
  const parsed = existingContent ? TOML.parse(existingContent) as Record<string, unknown> : {};
  const features = safeObject(parsed.features);
  const mcpServers = safeObject(parsed.mcp_servers);
  const coreOnly = options.coreOnly ?? false;

  parsed.features = {
    ...features,
    multi_agent: true,
    child_agents_md: true,
    codex_hooks: true
  };

  mcpServers.nx = {
    command: "bun",
    args: [path.join(packageRoot, "dist", "mcp", "server.js")]
  };

  if (!coreOnly) {
    if (!("context7" in mcpServers)) {
      mcpServers.context7 = {
        url: CONTEXT7_URL,
        bearer_token_env_var: CONTEXT7_BEARER_TOKEN_ENV_VAR
      };
    }
  } else if (isManagedContext7Server(mcpServers.context7)) {
    delete mcpServers.context7;
  }

  const hasContext7 = "context7" in mcpServers;

  parsed.developer_instructions = [
    "Nexus is installed.",
    "Use AGENTS.md as the primary orchestration surface.",
    "Use workflow skills via $nx-plan, $nx-run, $nx-init, and $nx-sync when routed by tags or user request.",
    "Use the nx MCP server for stateful plan, task, onboarding, and sync workflows.",
    ...(hasContext7 ? ["Use optional MCP integrations such as context7 for up-to-date library and API documentation when they are available."] : []),
    "Installed native subagents live under .codex/agents and are available for bounded delegation."
  ].join(" ");

  parsed.mcp_servers = mcpServers;

  return TOML.stringify(parsed as TOML.JsonMap);
}
