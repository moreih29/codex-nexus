import { describe, expect, test } from "bun:test";
import TOML from "@iarna/toml";
import { mergeManagedHooks } from "../src/config/codex-hooks.js";
import { nexusCoreCodexHookRuntimePath, nexusCoreMcpServerPath } from "../src/config/nexus-core.js";
import { adaptAgentRoleToml, isStandaloneAgentRoleToml, mergeConfigToml } from "../src/config/toml.js";

describe("config merge", () => {
  test("preserves user hook entries while appending managed hooks", () => {
    const merged = mergeManagedHooks(
      JSON.stringify({
        hooks: {
          SessionStart: [
            {
              hooks: [
                {
                  type: "command",
                  command: "echo custom"
                }
              ]
            }
          ]
        }
      }),
      process.cwd()
    );

    const parsed = JSON.parse(merged) as { hooks: Record<string, Array<Record<string, unknown>>> };
    expect(parsed.hooks.SessionStart.length).toBe(2);
    expect(parsed.hooks.SubagentStart).toBeArray();
  });

  test("injects nx and default hosted Context7 MCP servers plus features", () => {
    const merged = mergeConfigToml("", "/tmp/codex-nexus");
    expect(merged).toContain("codex_hooks = true");
    expect(merged).toContain("[mcp_servers.nx]");
    expect(merged).toContain(nexusCoreMcpServerPath("/tmp/codex-nexus"));
    expect(merged).toContain("[mcp_servers.context7]");
    expect(merged).toContain('url = "https://mcp.context7.com/mcp"');
    expect(merged).not.toContain('bearer_token_env_var = "CONTEXT7_API_KEY"');
    expect(merged).toContain("Use optional MCP integrations such as context7");
  });

  test("rewrites the legacy managed Context7 entry to the url-only default", () => {
    const merged = mergeConfigToml(TOML.stringify({
      mcp_servers: {
        context7: {
          url: "https://mcp.context7.com/mcp",
          bearer_token_env_var: "CONTEXT7_API_KEY"
        }
      }
    }), "/tmp/codex-nexus");

    expect(merged).toContain("[mcp_servers.context7]");
    expect(merged).toContain('url = "https://mcp.context7.com/mcp"');
    expect(merged).not.toContain('bearer_token_env_var = "CONTEXT7_API_KEY"');
  });

  test("preserves an existing custom Context7 MCP configuration", () => {
    const merged = mergeConfigToml(TOML.stringify({
      mcp_servers: {
        context7: {
          url: "https://example.com/mcp",
          bearer_token_env_var: "CUSTOM_CONTEXT7_TOKEN",
          startup_timeout_sec: 10
        }
      }
    }), "/tmp/codex-nexus");

    expect(merged).toContain("[mcp_servers.context7]");
    expect(merged).toContain('url = "https://example.com/mcp"');
    expect(merged).toContain('bearer_token_env_var = "CUSTOM_CONTEXT7_TOKEN"');
    expect(merged).toContain("startup_timeout_sec = 10");
  });

  test("removes only the default managed Context7 entry when opted out", () => {
    const managed = mergeConfigToml("", "/tmp/codex-nexus");
    const optedOut = mergeConfigToml(managed, "/tmp/codex-nexus", { coreOnly: true });
    expect(optedOut).not.toContain("[mcp_servers.context7]");
    expect(optedOut).not.toContain("Use optional MCP integrations such as context7");
  });

  test("keeps custom Context7 config when install opts out of the managed default", () => {
    const custom = mergeConfigToml(TOML.stringify({
      mcp_servers: {
        context7: {
          url: "https://example.com/mcp",
          bearer_token_env_var: "CUSTOM_CONTEXT7_TOKEN"
        }
      }
    }), "/tmp/codex-nexus", { coreOnly: true });

    expect(custom).toContain("[mcp_servers.context7]");
    expect(custom).toContain('url = "https://example.com/mcp"');
    expect(custom).toContain('bearer_token_env_var = "CUSTOM_CONTEXT7_TOKEN"');
  });

  test("registers nexus-core Codex hook runtimes in hooks.json", () => {
    const merged = mergeManagedHooks(null, process.cwd());
    const parsed = JSON.parse(merged) as {
      hooks: Record<string, Array<Record<string, unknown>>>;
    };

    expect(parsed.hooks.SessionStart[0]?.command).toContain(
      nexusCoreCodexHookRuntimePath(process.cwd(), "session-init.js")
    );
    expect(parsed.hooks.UserPromptSubmit[0]?.command).toContain(
      nexusCoreCodexHookRuntimePath(process.cwd(), "prompt-router.js")
    );
    expect(parsed.hooks.SubagentStart[0]?.command).toContain(
      nexusCoreCodexHookRuntimePath(process.cwd(), "agent-bootstrap.js")
    );
    expect(parsed.hooks.SubagentStop[0]?.command).toContain(
      nexusCoreCodexHookRuntimePath(process.cwd(), "agent-finalize.js")
    );
  });

  test("adapts role-local nx MCP server config to the core runtime path", () => {
    const adapted = adaptAgentRoleToml(
      [
        'name = "architect"',
        'description = "Technical design"',
        'developer_instructions = """role"""',
        'model = "gpt-5.4"',
        "",
        "[mcp_servers.nx]",
        'command = "nexus-mcp"',
        'disabled_tools = ["nx_task_add", "nx_task_update"]',
        ""
      ].join("\n"),
      "/tmp/codex-nexus"
    );
    const parsed = TOML.parse(adapted) as {
      mcp_servers?: {
        nx?: {
          command?: string;
          args?: string[];
          disabled_tools?: string[];
        };
      };
    };

    expect(adapted).toContain('[mcp_servers.nx]');
    expect(adapted).toContain('command = "node"');
    expect(adapted).toContain(nexusCoreMcpServerPath("/tmp/codex-nexus"));
    expect(adapted).not.toContain('command = "nexus-mcp"');
    expect(parsed.mcp_servers?.nx?.disabled_tools).toEqual(["nx_task_add", "nx_task_update"]);
  });

  test("rejects malformed standalone agent files with root-level disabled_tools", () => {
    const malformed = [
      'name = "architect"',
      'description = "Technical design"',
      'developer_instructions = """role"""',
      'disabled_tools = ["nx_task_add"]',
      ""
    ].join("\n");

    const valid = [
      'name = "architect"',
      'description = "Technical design"',
      'developer_instructions = """role"""',
      "",
      "[mcp_servers.nx]",
      'command = "node"',
      `args = ["${nexusCoreMcpServerPath("/tmp/codex-nexus")}"]`,
      'disabled_tools = ["nx_task_add"]',
      ""
    ].join("\n");

    expect(isStandaloneAgentRoleToml(malformed, "architect")).toBe(false);
    expect(isStandaloneAgentRoleToml(valid, "architect")).toBe(true);
  });
});
