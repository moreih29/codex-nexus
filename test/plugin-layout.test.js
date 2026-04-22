import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dir, "..");
const pluginRoot = path.join(repoRoot, "plugins", "codex-nexus");

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

test("wrapper metadata stays aligned", () => {
  const pkg = readJson(path.join(repoRoot, "package.json"));
  const manifest = readJson(path.join(pluginRoot, ".codex-plugin", "plugin.json"));
  const marketplace = readJson(path.join(repoRoot, ".agents", "plugins", "marketplace.json"));
  const mcp = readJson(path.join(pluginRoot, ".mcp.json"));
  const hooks = readJson(path.join(pluginRoot, "hooks.json"));
  const projectConfig = readFileSync(path.join(repoRoot, ".codex", "config.toml"), "utf8");

  expect(manifest.version).toBe(pkg.version);
  expect(manifest.skills).toBe("./skills/");
  expect(manifest.mcpServers).toBe("./.mcp.json");
  expect(marketplace.plugins[0].name).toBe("codex-nexus");
  expect(marketplace.plugins[0].source.path).toBe("./plugins/codex-nexus");
  expect(mcp.mcpServers.nx.command).toBe("npx");
  expect(hooks.hooks.SessionStart.length).toBeGreaterThan(0);
  expect(hooks.hooks.UserPromptSubmit.length).toBeGreaterThan(0);
  expect(hooks.hooks.PreToolUse.length).toBeGreaterThan(0);
  expect(pkg.bin["codex-nexus-hook"]).toBe("./scripts/codex-nexus-hook.mjs");
  expect(pkg.bin["codex-nexus"]).toBe("./scripts/codex-nexus.mjs");
  expect(existsSync(path.join(repoRoot, ".codex", "config.toml"))).toBe(true);
  expect(existsSync(path.join(repoRoot, ".codex", "hooks.json"))).toBe(true);
  expect(existsSync(path.join(repoRoot, ".codex", "lead.instructions.md"))).toBe(true);
  expect(existsSync(path.join(pluginRoot, "lead.instructions.md"))).toBe(true);
  expect(projectConfig).toContain('model_instructions_file = "lead.instructions.md"');
  expect(projectConfig).toContain("multi_agent = true");
  expect(projectConfig).toContain("child_agents_md = true");
  expect(projectConfig).toContain("[mcp_servers.nx]");
  expect(projectConfig).not.toContain('command = "npx"');
  expect(projectConfig).toContain("dist/mcp/server.js");
});

test("generated nexus-core artifacts are present", () => {
  expect(existsSync(path.join(pluginRoot, "skills", "nx-auto-plan", "SKILL.md"))).toBe(true);
  expect(existsSync(path.join(pluginRoot, "skills", "nx-plan", "SKILL.md"))).toBe(true);
  expect(existsSync(path.join(pluginRoot, "skills", "nx-run", "SKILL.md"))).toBe(true);
  expect(existsSync(path.join(pluginRoot, "agents", "lead.toml"))).toBe(true);
  expect(existsSync(path.join(repoRoot, ".codex", "agents", "lead.toml"))).toBe(true);
  expect(existsSync(path.join(repoRoot, ".agents", "skills", "nx-plan", "SKILL.md"))).toBe(true);
});
