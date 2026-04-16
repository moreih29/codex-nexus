import { describe, expect, test } from "bun:test";
import TOML from "@iarna/toml";
import { AGENT_DEFINITIONS } from "../src/agents/definitions.js";
import { generateAgentToml } from "../src/agents/native-config.js";

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function parseAgentToml(agentName: string): Record<string, unknown> {
  const agent = AGENT_DEFINITIONS[agentName];
  const toml = generateAgentToml(agent, `Prompt for ${agentName}`);
  return TOML.parse(toml) as Record<string, unknown>;
}

function readNxDisabledTools(parsed: Record<string, unknown>): string[] {
  const mcpServers = asObject(parsed.mcp_servers);
  const nxServer = asObject(mcpServers.nx);
  const disabledTools = nxServer.disabled_tools;
  return Array.isArray(disabledTools)
    ? disabledTools.filter((value): value is string => typeof value === "string")
    : [];
}

describe("native agent capability restrictions", () => {
  test("applies no_task_create restrictions to engineer configs", () => {
    const parsed = parseAgentToml("engineer");

    expect(parsed.sandbox_mode).toBeUndefined();
    expect(parsed.include_apply_patch_tool).toBeUndefined();
    expect(readNxDisabledTools(parsed)).toEqual(["nx_task_close", "nx_task_add"]);
  });

  test("applies no_file_edit restrictions to researcher configs", () => {
    const parsed = parseAgentToml("researcher");

    expect(parsed.sandbox_mode).toBe("read-only");
    expect(parsed.include_apply_patch_tool).toBe(false);
    expect(readNxDisabledTools(parsed)).toEqual(["nx_task_close", "nx_task_add"]);
  });

  test("applies no_task_update restrictions to architect configs", () => {
    const parsed = parseAgentToml("architect");

    expect(parsed.sandbox_mode).toBe("read-only");
    expect(parsed.include_apply_patch_tool).toBe(false);
    expect(readNxDisabledTools(parsed)).toEqual(["nx_task_close", "nx_task_add", "nx_task_update"]);
  });
});
