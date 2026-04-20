import TOML from "@iarna/toml";
import { nexusCoreMcpServerPath } from "./nexus-core.js";

const CONTEXT7_URL = "https://mcp.context7.com/mcp";
const CONTEXT7_BEARER_TOKEN_ENV_VAR = "CONTEXT7_API_KEY";
const MANAGED_NX_MCP_SERVER = "nx";

export interface ManagedConfigOptions {
  coreOnly?: boolean;
}

function safeObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function managedNxMcpServerConfig(packageRoot: string, disabledTools?: unknown): Record<string, unknown> {
  const server: Record<string, unknown> = {
    command: "node",
    args: [nexusCoreMcpServerPath(packageRoot)]
  };

  if (isStringArray(disabledTools) && disabledTools.length > 0) {
    server.disabled_tools = disabledTools;
  }

  return server;
}

function managedContext7ServerConfig(): Record<string, unknown> {
  return {
    url: CONTEXT7_URL
  };
}

function isManagedContext7Server(value: unknown): boolean {
  const record = safeObject(value);
  const keys = Object.keys(record);
  return record.url === CONTEXT7_URL &&
    keys.every((key) => key === "url" || key === "bearer_token_env_var") &&
    (!("bearer_token_env_var" in record) || record.bearer_token_env_var === CONTEXT7_BEARER_TOKEN_ENV_VAR);
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

  mcpServers[MANAGED_NX_MCP_SERVER] = managedNxMcpServerConfig(packageRoot);

  if (!coreOnly) {
    if (!("context7" in mcpServers) || isManagedContext7Server(mcpServers.context7)) {
      mcpServers.context7 = managedContext7ServerConfig();
    }
  } else if (isManagedContext7Server(mcpServers.context7)) {
    delete mcpServers.context7;
  }

  const hasContext7 = "context7" in mcpServers;

  parsed.developer_instructions = [
    "Nexus is installed.",
    "Core Codex agents and skills are sourced from @moreih29/nexus-core.",
    "Use AGENTS.md as the primary orchestration surface.",
    "Use workflow skills via $nx-plan, $nx-run, $nx-init, and $nx-sync when routed by tags or user request.",
    "Use the nx MCP server for core plan, task, history, artifact, and related runtime workflows.",
    ...(hasContext7 ? ["Use optional MCP integrations such as context7 for up-to-date library and API documentation when they are available."] : []),
    "Installed native subagents live under .codex/agents and are core-generated Codex wrappers."
  ].join(" ");

  parsed.mcp_servers = mcpServers;

  return TOML.stringify(parsed as TOML.JsonMap);
}

export function adaptAgentRoleToml(existingContent: string, packageRoot: string): string {
  const parsed = TOML.parse(existingContent) as Record<string, unknown>;
  const mcpServers = safeObject(parsed.mcp_servers);
  const existingNxServer = safeObject(mcpServers[MANAGED_NX_MCP_SERVER]);
  const rootDisabledTools = parsed.disabled_tools;
  const hasNxServer = MANAGED_NX_MCP_SERVER in mcpServers;

  delete parsed.disabled_tools;

  if (rootDisabledTools !== undefined || hasNxServer) {
    mcpServers[MANAGED_NX_MCP_SERVER] = managedNxMcpServerConfig(
      packageRoot,
      existingNxServer.disabled_tools ?? rootDisabledTools
    );
    parsed.mcp_servers = mcpServers;
  }

  return TOML.stringify(parsed as TOML.JsonMap);
}

export function isStandaloneAgentRoleToml(existingContent: string, agentName: string): boolean {
  try {
    const parsed = TOML.parse(existingContent) as Record<string, unknown>;
    if (parsed.name !== agentName) {
      return false;
    }

    if (typeof parsed.developer_instructions !== "string" || parsed.developer_instructions.trim().length === 0) {
      return false;
    }

    if (Object.keys(safeObject(parsed.agents)).length > 0 || "disabled_tools" in parsed) {
      return false;
    }

    const mcpServers = safeObject(parsed.mcp_servers);
    if (!(MANAGED_NX_MCP_SERVER in mcpServers)) {
      return true;
    }

    const nxServer = safeObject(mcpServers[MANAGED_NX_MCP_SERVER]);
    if (typeof nxServer.command !== "string" || nxServer.command.trim().length === 0) {
      return false;
    }

    if ("args" in nxServer && !isStringArray(nxServer.args)) {
      return false;
    }

    if ("disabled_tools" in nxServer && !isStringArray(nxServer.disabled_tools)) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}
