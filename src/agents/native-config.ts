import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { AGENT_DEFINITIONS, AGENT_MODEL_BY_CATEGORY, type AgentDefinition } from "./definitions.js";

function stripFrontmatter(content: string): string {
  const match = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  return match ? content.slice(match[0].length).trim() : content.trim();
}

function escapeTomlBasicString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function escapeTomlMultiline(value: string): string {
  return value.replace(/"{3,}/g, (match) => match.split("").join("\\"));
}

export function generateStandaloneAgentToml(config: {
  name: string;
  description: string;
  developerInstructions: string;
  model: string;
}): string {
  const lines = [
    `name = "${escapeTomlBasicString(config.name)}"`,
    `description = "${escapeTomlBasicString(config.description)}"`,
    `model = "${escapeTomlBasicString(config.model)}"`,
    'developer_instructions = """',
    escapeTomlMultiline(config.developerInstructions),
    '"""',
    ""
  ];
  return lines.join("\n");
}

export function generateAgentToml(agent: AgentDefinition, promptContent: string): string {
  return generateStandaloneAgentToml({
    name: agent.name,
    description: agent.description,
    developerInstructions: stripFrontmatter(promptContent),
    model: AGENT_MODEL_BY_CATEGORY[agent.category]
  });
}

const LEGACY_MANAGED_AGENT_FILES = [
  {
    name: "nexus",
    signatures: [
      'name = "nexus"',
      "Nexus-aware orchestration lead for plan, run, delegation, and verification workflows",
      "You are Nexus, the primary orchestration lead for `codex-nexus`."
    ]
  }
] as const;

async function cleanupLegacyManagedAgentFiles(agentsDir: string): Promise<void> {
  for (const legacyAgent of LEGACY_MANAGED_AGENT_FILES) {
    const agentPath = path.join(agentsDir, `${legacyAgent.name}.toml`);
    if (!existsSync(agentPath)) continue;

    const content = await readFile(agentPath, "utf8");
    const matchesManagedSignature = legacyAgent.signatures.every((signature) => content.includes(signature));
    if (!matchesManagedSignature) continue;

    await rm(agentPath, { force: true });
  }
}

export async function installNativeAgentConfigs(
  packageRoot: string,
  agentsDir: string
): Promise<string[]> {
  await mkdir(agentsDir, { recursive: true });
  await cleanupLegacyManagedAgentFiles(agentsDir);

  const installed: string[] = [];

  for (const [name, agent] of Object.entries(AGENT_DEFINITIONS)) {
    const promptPath = path.join(packageRoot, "prompts", `${name}.md`);
    if (!existsSync(promptPath)) continue;

    const promptContent = await readFile(promptPath, "utf8");
    const toml = generateAgentToml(agent, promptContent);
    await writeFile(path.join(agentsDir, `${name}.toml`), toml, "utf8");
    installed.push(name);
  }

  return installed;
}
