import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { getCurrentVersion } from "../src/shared/version.js";

describe("synced nexus-core Codex assets", () => {
  test("build no longer emits wrapper-owned MCP or hook runtimes", () => {
    expect(existsSync(path.join(process.cwd(), "dist", "mcp", "server.js"))).toBe(false);
    expect(existsSync(path.join(process.cwd(), "dist", "hooks", "codex-native-hook.js"))).toBe(false);
  });

  test("ships core-generated skills under plugin/skills", () => {
    const skillPath = path.join(process.cwd(), "plugin", "skills", "nx-run", "SKILL.md");
    const pluginManifestPath = path.join(process.cwd(), "plugin", ".codex-plugin", "plugin.json");
    expect(existsSync(skillPath)).toBe(true);
    expect(existsSync(pluginManifestPath)).toBe(true);

    const skill = readFileSync(skillPath, "utf8");
    const pluginManifest = JSON.parse(readFileSync(pluginManifestPath, "utf8")) as {
      name?: string;
      version?: string;
    };
    expect(skill).toContain("Execution norm that Lead follows when the user invokes the [run] tag");
    expect(skill).toContain("$nx-plan");
    expect(skill).toContain("update_plan([{ name:");
    expect(pluginManifest.name).toBe("codex-nexus");
    expect(pluginManifest.version).toBe(getCurrentVersion());
  });

  test("ships core-generated agent, prompt, and install fragments", () => {
    const leadAgentPath = path.join(process.cwd(), "agents", "lead.toml");
    const architectAgentPath = path.join(process.cwd(), "agents", "architect.toml");
    const leadPromptPath = path.join(process.cwd(), "prompts", "lead.md");
    const agentsFragmentPath = path.join(process.cwd(), "install", "AGENTS.fragment.md");
    const configFragmentPath = path.join(process.cwd(), "install", "config.fragment.toml");

    expect(existsSync(leadAgentPath)).toBe(true);
    expect(existsSync(architectAgentPath)).toBe(true);
    expect(existsSync(leadPromptPath)).toBe(true);
    expect(existsSync(agentsFragmentPath)).toBe(true);
    expect(existsSync(configFragmentPath)).toBe(true);

    const agentToml = readFileSync(leadAgentPath, "utf8");
    const architectToml = readFileSync(architectAgentPath, "utf8");
    const prompt = readFileSync(leadPromptPath, "utf8");
    const fragment = readFileSync(agentsFragmentPath, "utf8");
    const configFragment = readFileSync(configFragmentPath, "utf8");

    expect(agentToml).toContain('name = "lead"');
    expect(agentToml).toContain('developer_instructions = """');
    expect(agentToml).toContain('model = "gpt-5.4"');
    expect(agentToml).not.toContain("[agents.");
    expect(architectToml).toContain("[mcp_servers.nx]");
    expect(architectToml).toContain('command = "nexus-mcp"');
    expect(architectToml).toContain('disabled_tools = ["nx_task_add", "nx_task_update"]');
    expect(prompt).toContain("You are Lead");
    expect(fragment).toContain("<!-- nexus-core:lead:start -->");
    expect(fragment).toContain("# lead");
    expect(configFragment).toContain("[mcp_servers.nx]");
  });
});
