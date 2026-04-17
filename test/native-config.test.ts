import { describe, expect, test } from "bun:test";
import TOML from "@iarna/toml";
import path from "node:path";
import { AGENT_DEFINITIONS } from "../src/agents/definitions.js";
import { generateAgentToml } from "../src/agents/native-config.js";

const TEST_PACKAGE_ROOT = "/tmp/codex-nexus";

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function parseAgentToml(agentName: string): Record<string, unknown> {
  const agent = AGENT_DEFINITIONS[agentName];
  const toml = generateAgentToml(agent, `Prompt for ${agentName}`, TEST_PACKAGE_ROOT);
  return TOML.parse(toml) as Record<string, unknown>;
}

function readNxServer(parsed: Record<string, unknown>): Record<string, unknown> {
  const mcpServers = asObject(parsed.mcp_servers);
  return asObject(mcpServers.nx);
}

function readNxDisabledTools(parsed: Record<string, unknown>): string[] {
  const nxServer = readNxServer(parsed);
  const disabledTools = nxServer.disabled_tools;
  return Array.isArray(disabledTools)
    ? disabledTools.filter((value): value is string => typeof value === "string")
    : [];
}

describe("native agent capability restrictions", () => {
  test("applies no_task_create restrictions to engineer configs", () => {
    const parsed = parseAgentToml("engineer");
    const nxServer = readNxServer(parsed);

    expect(parsed.sandbox_mode).toBeUndefined();
    expect(nxServer.command).toBe("bun");
    expect(nxServer.args).toEqual([path.join(TEST_PACKAGE_ROOT, "dist", "mcp", "server.js")]);
    expect(readNxDisabledTools(parsed)).toEqual(["nx_task_close", "nx_task_add"]);
  });

  test("applies no_file_edit restrictions to researcher configs", () => {
    const parsed = parseAgentToml("researcher");
    const nxServer = readNxServer(parsed);

    expect(parsed.sandbox_mode).toBe("read-only");
    expect(nxServer.command).toBe("bun");
    expect(nxServer.args).toEqual([path.join(TEST_PACKAGE_ROOT, "dist", "mcp", "server.js")]);
    expect(readNxDisabledTools(parsed)).toEqual(["nx_task_close", "nx_task_add"]);
  });

  test("applies no_task_update restrictions to architect configs", () => {
    const parsed = parseAgentToml("architect");
    const nxServer = readNxServer(parsed);

    expect(parsed.sandbox_mode).toBe("read-only");
    expect(nxServer.command).toBe("bun");
    expect(nxServer.args).toEqual([path.join(TEST_PACKAGE_ROOT, "dist", "mcp", "server.js")]);
    expect(readNxDisabledTools(parsed)).toEqual(["nx_task_close", "nx_task_add", "nx_task_update"]);
  });

  test("prefers prompt frontmatter metadata when generating agent configs", () => {
    const parsed = TOML.parse(
      generateAgentToml(
        AGENT_DEFINITIONS.engineer,
        [
          "---",
          'name: "engineer"',
          'description: "Prompt-owned description"',
          'category: "how"',
          "---",
          "",
          "Prompt body"
        ].join("\n"),
        TEST_PACKAGE_ROOT
      )
    ) as Record<string, unknown>;
    const nxServer = readNxServer(parsed);

    expect(parsed.description).toBe("Prompt-owned description");
    expect(parsed.model).toBe("gpt-5.4");
    expect(parsed.developer_instructions).toBe("Prompt body\n");
    expect(nxServer.command).toBe("bun");
    expect(nxServer.args).toEqual([path.join(TEST_PACKAGE_ROOT, "dist", "mcp", "server.js")]);
    expect(readNxDisabledTools(parsed)).toEqual(["nx_task_close", "nx_task_add"]);
  });
});
