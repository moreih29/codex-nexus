import { expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import TOML from "@iarna/toml";

const repoRoot = path.resolve(import.meta.dir, "..");
const pluginRoot = path.join(repoRoot, "plugins", "codex-nexus");
const expectedSubagentFiles = [
  "architect.toml",
  "designer.toml",
  "postdoc.toml",
  "engineer.toml",
  "researcher.toml",
  "writer.toml",
  "reviewer.toml",
  "tester.toml"
];
const expectedAgentFiles = ["lead.toml", ...expectedSubagentFiles].sort();
const expectedNxAgentFiles = [...expectedSubagentFiles];

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function packageFilesIncludePath(packageFiles, filePath) {
  const normalizedPath = path.relative(repoRoot, filePath).split(path.sep).join("/");

  return packageFiles.some((entry) => {
    const normalizedEntry = entry.replace(/\/+$/, "");
    return normalizedPath === normalizedEntry || normalizedPath.startsWith(`${normalizedEntry}/`);
  });
}

test("wrapper metadata stays aligned", () => {
  const pkg = readJson(path.join(repoRoot, "package.json"));
  const manifest = readJson(path.join(pluginRoot, ".codex-plugin", "plugin.json"));
  const mcp = readJson(path.join(pluginRoot, ".mcp.json"));
  const hooksPath = path.join(pluginRoot, "hooks.json");
  const manifestHooksPath = path.resolve(pluginRoot, manifest.hooks ?? "");

  expect(manifest.version).toBe(pkg.version);
  expect(manifest.skills).toBe("./skills/");
  expect(manifest.mcpServers).toBe("./.mcp.json");
  expect(manifest.hooks).toBe("./hooks.json");
  expect(manifestHooksPath).toBe(hooksPath);
  expect(existsSync(manifestHooksPath)).toBe(true);

  const hooks = readJson(manifestHooksPath);

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
  expect(packageFilesIncludePath(pkg.files, manifestHooksPath)).toBe(true);
  expect(pkg.files).not.toContain(".codex");
  expect(pkg.files).not.toContain(".agents");
});

test("generated nexus-core artifacts are present", () => {
  expect(existsSync(path.join(pluginRoot, "skills", "nx-auto-plan", "SKILL.md"))).toBe(true);
  expect(existsSync(path.join(pluginRoot, "skills", "nx-plan", "SKILL.md"))).toBe(true);
  expect(existsSync(path.join(pluginRoot, "skills", "nx-run", "SKILL.md"))).toBe(true);
  expect(existsSync(path.join(pluginRoot, "agents", "lead.toml"))).toBe(true);
  expect(readdirSync(path.join(pluginRoot, "agents")).filter((entry) => entry.endsWith(".toml")).sort()).toEqual(expectedAgentFiles);
  expect(existsSync(path.join(pluginRoot, "agents", "strategist.toml"))).toBe(false);
  expect(TOML.parse(readFileSync(path.join(pluginRoot, "agents", "lead.toml"), "utf8")).model).toBeUndefined();
});

test("generated subagent nx MCP config stays aligned with upstream launcher metadata", () => {
  const agentFiles = expectedNxAgentFiles;

  for (const agentFile of agentFiles) {
    const parsed = TOML.parse(readFileSync(path.join(pluginRoot, "agents", agentFile), "utf8"));
    const nx = parsed?.mcp_servers?.nx ?? {};
    expect(parsed.model).toBeUndefined();
    expect(nx.command).toBe("nexus-mcp");
    expect(nx.args).toBeUndefined();
    expect(Array.isArray(nx.disabled_tools)).toBe(true);
  }
});
