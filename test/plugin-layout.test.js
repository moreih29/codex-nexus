import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import TOML from "@iarna/toml";

const repoRoot = path.resolve(import.meta.dir, "..");
const pluginRoot = path.join(repoRoot, "plugins", "codex-nexus");

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

test("wrapper metadata stays aligned", () => {
  const pkg = readJson(path.join(repoRoot, "package.json"));
  const manifest = readJson(path.join(pluginRoot, ".codex-plugin", "plugin.json"));
  const mcp = readJson(path.join(pluginRoot, ".mcp.json"));
  const hooks = readJson(path.join(pluginRoot, "hooks.json"));

  expect(manifest.version).toBe(pkg.version);
  expect(manifest.skills).toBe("./skills/");
  expect(manifest.mcpServers).toBe("./.mcp.json");
  expect(mcp.mcpServers.nx.command).toBe("npx");
  expect(mcp.mcpServers.nx.args).toContain(`@moreih29/nexus-core@${pkg.dependencies["@moreih29/nexus-core"]}`);
  expect(hooks.hooks.SessionStart.length).toBeGreaterThan(0);
  expect(hooks.hooks.UserPromptSubmit.length).toBeGreaterThan(0);
  expect(hooks.hooks.PreToolUse.length).toBeGreaterThan(0);
  expect(hooks.hooks.PermissionRequest.length).toBeGreaterThan(0);
  expect(hooks.hooks.Stop.length).toBeGreaterThan(0);
  expect(hooks.hooks.PreToolUse[0].matcher).toContain("apply_patch");
  expect(hooks.hooks.PreToolUse[0].matcher).toContain("mcp__");
  expect(hooks.hooks.PermissionRequest[0].matcher).toContain("apply_patch");
  expect(hooks.hooks.PermissionRequest[0].matcher).toContain("mcp__");
  expect(pkg.bin["codex-nexus-hook"]).toBe("./scripts/codex-nexus-hook.mjs");
  expect(pkg.bin["codex-nexus"]).toBe("./scripts/codex-nexus.mjs");
  expect(existsSync(path.join(pluginRoot, "lead.instructions.md"))).toBe(true);
  expect(pkg.files).toContain("plugins");
  expect(pkg.files).not.toContain(".codex");
  expect(pkg.files).not.toContain(".agents");
});

test("generated nexus-core artifacts are present", () => {
  expect(existsSync(path.join(pluginRoot, "skills", "nx-auto-plan", "SKILL.md"))).toBe(true);
  expect(existsSync(path.join(pluginRoot, "skills", "nx-plan", "SKILL.md"))).toBe(true);
  expect(existsSync(path.join(pluginRoot, "skills", "nx-run", "SKILL.md"))).toBe(true);
  expect(existsSync(path.join(pluginRoot, "agents", "lead.toml"))).toBe(true);
  expect(TOML.parse(readFileSync(path.join(pluginRoot, "agents", "lead.toml"), "utf8")).model).toBeUndefined();
});

test("generated subagent nx MCP config stays aligned with upstream launcher metadata", () => {
  const agentFiles = ["architect.toml", "designer.toml", "engineer.toml", "postdoc.toml", "researcher.toml", "reviewer.toml", "strategist.toml", "tester.toml", "writer.toml"]
    .filter((entry) => existsSync(path.join(pluginRoot, "agents", entry)));

  expect(agentFiles.length).toBeGreaterThan(0);
  for (const agentFile of agentFiles) {
    const parsed = TOML.parse(readFileSync(path.join(pluginRoot, "agents", agentFile), "utf8"));
    const nx = parsed?.mcp_servers?.nx ?? {};
    expect(parsed.model).toBeUndefined();
    expect(nx.command).toBe("nexus-mcp");
    expect(nx.args).toBeUndefined();
    expect(Array.isArray(nx.disabled_tools)).toBe(true);
  }
});
