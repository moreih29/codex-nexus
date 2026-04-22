import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import TOML from "@iarna/toml";

const repoRoot = path.resolve(import.meta.dirname, "..");
const packageJsonPath = path.join(repoRoot, "package.json");
const pluginRoot = path.join(repoRoot, "plugins", "codex-nexus");
const manifestPath = path.join(pluginRoot, ".codex-plugin", "plugin.json");
const mcpPath = path.join(pluginRoot, ".mcp.json");
const hooksPath = path.join(pluginRoot, "hooks.json");
const cliPath = path.join(repoRoot, "scripts", "codex-nexus.mjs");
const pluginLeadInstructionsPath = path.join(pluginRoot, "lead.instructions.md");
const skillsPath = path.join(pluginRoot, "skills");
const agentsPath = path.join(pluginRoot, "agents");

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const pkg = readJson(packageJsonPath);
const manifest = readJson(manifestPath);
const mcp = readJson(mcpPath);
const hooks = readJson(hooksPath);

assert(pkg.version === manifest.version, "package.json and plugin.json versions must match.");
assert(manifest.name === "codex-nexus", "plugin.json name must be codex-nexus.");
assert(manifest.skills === "./skills/", "plugin.json skills path must be ./skills/.");
assert(manifest.mcpServers === "./.mcp.json", "plugin.json mcpServers path must be ./.mcp.json.");

assert(mcp.mcpServers?.nx, ".mcp.json must register the nx MCP server.");
assert(mcp.mcpServers.nx.command === "npx", "nx MCP server must use npx.");
assert(
  Array.isArray(mcp.mcpServers.nx.args) &&
  mcp.mcpServers.nx.args.includes(`@moreih29/nexus-core@${pkg.dependencies["@moreih29/nexus-core"]}`),
  ".mcp.json must pin the same @moreih29/nexus-core version as package.json."
);
assert(Array.isArray(hooks.hooks?.SessionStart), "hooks.json must define SessionStart hooks.");
assert(Array.isArray(hooks.hooks?.UserPromptSubmit), "hooks.json must define UserPromptSubmit hooks.");
assert(Array.isArray(hooks.hooks?.PreToolUse), "hooks.json must define PreToolUse hooks.");
assert(
  hooks.hooks.UserPromptSubmit[0]?.hooks?.[0]?.command?.includes(`codex-nexus@${pkg.version}`),
  "UserPromptSubmit hook must pin the current codex-nexus version."
);
assert(existsSync(pluginLeadInstructionsPath), "Plugin lead.instructions.md must exist.");
assert(existsSync(cliPath), "CLI installer script must exist.");

assert(existsSync(skillsPath), "Generated skills directory is missing. Run 'bun run sync:core'.");
assert(existsSync(agentsPath), "Generated agents directory is missing. Run 'bun run sync:core'.");
assert(pkg.bin?.["codex-nexus-hook"] === "./scripts/codex-nexus-hook.mjs", "package bin must expose codex-nexus-hook.");
assert(pkg.bin?.["codex-nexus"] === "./scripts/codex-nexus.mjs", "package bin must expose codex-nexus.");
assert(Array.isArray(pkg.files), "package.json files must be an array.");
assert(pkg.files.includes("plugins"), "package.json files must include the publishable plugins directory.");
assert(!pkg.files.includes(".codex"), "package.json files must not include local .codex install artifacts.");
assert(!pkg.files.includes(".agents"), "package.json files must not include local .agents install artifacts.");

const requiredSkills = ["nx-auto-plan", "nx-plan", "nx-run"];
for (const skillName of requiredSkills) {
  assert(
    existsSync(path.join(skillsPath, skillName, "SKILL.md")),
    `Missing generated skill: ${skillName}`
  );
}

assert(existsSync(path.join(agentsPath, "lead.toml")), "Missing generated lead agent.");
assert(readdirSync(agentsPath).length >= 3, "Expected multiple generated agents in plugins/codex-nexus/agents.");
for (const agentFile of readdirSync(agentsPath).filter((entry) => entry.endsWith(".toml"))) {
  const parsed = TOML.parse(readFileSync(path.join(agentsPath, agentFile), "utf8"));
  const nxConfig = parsed?.mcp_servers?.nx ?? {};
  assert(nxConfig.command !== "nexus-mcp", `Agent ${agentFile} must not use bare nexus-mcp.`);
}

for (const assetPath of [manifest.interface.composerIcon, manifest.interface.logo]) {
  assert(existsSync(path.join(pluginRoot, assetPath.replace(/^\.\//, ""))), `Missing asset referenced by plugin manifest: ${assetPath}`);
}

console.log("Plugin wrapper validation passed.");
