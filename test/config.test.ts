import { describe, expect, test } from "bun:test";
import TOML from "@iarna/toml";
import { mergeManagedHooks } from "../src/config/codex-hooks.js";
import { mergeConfigToml } from "../src/config/toml.js";

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
      "/tmp/codex-nexus"
    );

    const parsed = JSON.parse(merged) as { hooks: Record<string, Array<Record<string, unknown>>> };
    expect(parsed.hooks.SessionStart.length).toBe(2);
  });

  test("injects nx and default hosted Context7 MCP servers plus features", () => {
    const merged = mergeConfigToml("", "/tmp/codex-nexus");
    expect(merged).toContain("codex_hooks = true");
    expect(merged).toContain("[mcp_servers.nx]");
    expect(merged).toContain("/tmp/codex-nexus/dist/mcp/server.js");
    expect(merged).toContain("[mcp_servers.context7]");
    expect(merged).toContain('url = "https://mcp.context7.com/mcp"');
    expect(merged).toContain('bearer_token_env_var = "CONTEXT7_API_KEY"');
    expect(merged).toContain("Use the context7 MCP server");
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
    const optedOut = mergeConfigToml(managed, "/tmp/codex-nexus", { includeContext7: false });
    expect(optedOut).not.toContain("[mcp_servers.context7]");
    expect(optedOut).not.toContain("Use the context7 MCP server");
  });

  test("keeps custom Context7 config when install opts out of the managed default", () => {
    const custom = mergeConfigToml(TOML.stringify({
      mcp_servers: {
        context7: {
          url: "https://example.com/mcp",
          bearer_token_env_var: "CUSTOM_CONTEXT7_TOKEN"
        }
      }
    }), "/tmp/codex-nexus", { includeContext7: false });

    expect(custom).toContain("[mcp_servers.context7]");
    expect(custom).toContain('url = "https://example.com/mcp"');
    expect(custom).toContain('bearer_token_env_var = "CUSTOM_CONTEXT7_TOKEN"');
  });

  test("registers PostToolUse hook without Bash-only matcher", () => {
    const merged = mergeManagedHooks(null, "/tmp/codex-nexus");
    const parsed = JSON.parse(merged) as {
      hooks: Record<string, Array<Record<string, unknown>>>;
    };

    expect(parsed.hooks.PreToolUse[0]?.matcher).toBe("Bash");
    expect(parsed.hooks.PostToolUse[0]?.matcher).toBeUndefined();
  });
});
