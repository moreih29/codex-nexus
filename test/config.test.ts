import { describe, expect, test } from "bun:test";
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

  test("injects nx MCP server and features", () => {
    const merged = mergeConfigToml("", "/tmp/codex-nexus");
    expect(merged).toContain("codex_hooks = true");
    expect(merged).toContain("[mcp_servers.nx]");
    expect(merged).toContain("/tmp/codex-nexus/dist/mcp/server.js");
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
