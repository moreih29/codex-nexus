import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const packageJsonPath = path.join(repoRoot, "package.json");
const pluginRoot = path.join(repoRoot, "plugins", "codex-nexus");
const manifestPath = path.join(pluginRoot, ".codex-plugin", "plugin.json");
const marketplacePath = path.join(repoRoot, ".agents", "plugins", "marketplace.json");
const mcpPath = path.join(pluginRoot, ".mcp.json");
const hooksPath = path.join(pluginRoot, "hooks.json");
const cliPath = path.join(repoRoot, "scripts", "codex-nexus.mjs");
const projectCodexConfigPath = path.join(repoRoot, ".codex", "config.toml");
const projectCodexHooksPath = path.join(repoRoot, ".codex", "hooks.json");
const projectLeadInstructionsPath = path.join(repoRoot, ".codex", "lead.instructions.md");
const projectCodexAgentsPath = path.join(repoRoot, ".codex", "agents");
const projectAgentsSkillsPath = path.join(repoRoot, ".agents", "skills");
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
const marketplace = readJson(marketplacePath);
const mcp = readJson(mcpPath);
const hooks = readJson(hooksPath);

assert(pkg.version === manifest.version, "package.json and plugin.json versions must match.");
assert(manifest.name === "codex-nexus", "plugin.json name must be codex-nexus.");
assert(manifest.skills === "./skills/", "plugin.json skills path must be ./skills/.");
assert(manifest.mcpServers === "./.mcp.json", "plugin.json mcpServers path must be ./.mcp.json.");
assert(Array.isArray(marketplace.plugins), "marketplace.json plugins must be an array.");

const pluginEntry = marketplace.plugins.find((entry) => entry.name === manifest.name);
assert(pluginEntry, "marketplace.json must include a codex-nexus entry.");
assert(pluginEntry.source?.path === "./plugins/codex-nexus", "marketplace entry path must target ./plugins/codex-nexus.");
assert(pluginEntry.policy?.installation === "AVAILABLE", "marketplace installation policy must be AVAILABLE.");
assert(pluginEntry.policy?.authentication === "ON_INSTALL", "marketplace authentication policy must be ON_INSTALL.");

assert(mcp.mcpServers?.nx, ".mcp.json must register the nx MCP server.");
assert(mcp.mcpServers.nx.command === "npx", "nx MCP server must use npx.");
assert(Array.isArray(hooks.hooks?.SessionStart), "hooks.json must define SessionStart hooks.");
assert(Array.isArray(hooks.hooks?.UserPromptSubmit), "hooks.json must define UserPromptSubmit hooks.");
assert(Array.isArray(hooks.hooks?.PreToolUse), "hooks.json must define PreToolUse hooks.");
assert(
  hooks.hooks.UserPromptSubmit[0]?.hooks?.[0]?.command?.includes(`codex-nexus@${pkg.version}`),
  "UserPromptSubmit hook must pin the current codex-nexus version."
);
assert(existsSync(projectCodexConfigPath), "Project .codex/config.toml must exist.");
assert(existsSync(projectCodexHooksPath), "Project .codex/hooks.json must exist.");
assert(existsSync(projectLeadInstructionsPath), "Project .codex/lead.instructions.md must exist.");
assert(existsSync(pluginLeadInstructionsPath), "Plugin lead.instructions.md must exist.");
assert(existsSync(projectCodexAgentsPath), "Project .codex/agents must exist.");
assert(existsSync(projectAgentsSkillsPath), "Project .agents/skills must exist.");
assert(existsSync(cliPath), "CLI installer script must exist.");

assert(existsSync(skillsPath), "Generated skills directory is missing. Run 'bun run sync:core'.");
assert(existsSync(agentsPath), "Generated agents directory is missing. Run 'bun run sync:core'.");
assert(pkg.bin?.["codex-nexus-hook"] === "./scripts/codex-nexus-hook.mjs", "package bin must expose codex-nexus-hook.");
assert(pkg.bin?.["codex-nexus"] === "./scripts/codex-nexus.mjs", "package bin must expose codex-nexus.");
assert(
  readFileSync(projectCodexConfigPath, "utf8").includes('model_instructions_file = "lead.instructions.md"'),
  ".codex/config.toml must set model_instructions_file."
);
assert(
  readFileSync(projectCodexConfigPath, "utf8").includes('[mcp_servers.nx]'),
  ".codex/config.toml must register mcp_servers.nx."
);
assert(
  !readFileSync(projectCodexConfigPath, "utf8").includes('command = "npx"'),
  ".codex/config.toml must not rely on npx for nx MCP."
);
assert(
  readFileSync(projectCodexConfigPath, "utf8").includes("dist/mcp/server.js"),
  ".codex/config.toml must point at the installed nexus-mcp server entry."
);
assert(
  readFileSync(projectCodexConfigPath, "utf8").includes("multi_agent = true"),
  ".codex/config.toml must enable features.multi_agent."
);
assert(
  readFileSync(projectCodexConfigPath, "utf8").includes("child_agents_md = true"),
  ".codex/config.toml must enable features.child_agents_md."
);

const requiredSkills = ["nx-auto-plan", "nx-plan", "nx-run"];
for (const skillName of requiredSkills) {
  assert(
    existsSync(path.join(skillsPath, skillName, "SKILL.md")),
    `Missing generated skill: ${skillName}`
  );
}

assert(existsSync(path.join(agentsPath, "lead.toml")), "Missing generated lead agent.");
assert(readdirSync(agentsPath).length >= 3, "Expected multiple generated agents in plugins/codex-nexus/agents.");
assert(existsSync(path.join(projectCodexAgentsPath, "lead.toml")), "Missing project .codex lead agent.");
assert(existsSync(path.join(projectAgentsSkillsPath, "nx-plan", "SKILL.md")), "Missing project .agents nx-plan skill.");

for (const assetPath of [manifest.interface.composerIcon, manifest.interface.logo]) {
  assert(existsSync(path.join(pluginRoot, assetPath.replace(/^\.\//, ""))), `Missing asset referenced by plugin manifest: ${assetPath}`);
}

console.log("Plugin wrapper validation passed.");
