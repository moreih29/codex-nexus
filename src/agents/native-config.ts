import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  AGENT_DEFINITIONS,
  AGENT_MODEL_BY_CATEGORY,
  type AgentCapability,
  type AgentDefinition
} from "./definitions.js";
import { parseAgentPromptMetadata } from "./prompt-metadata.js";

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

function formatTomlStringArray(values: readonly string[]): string {
  return `[${values.map((value) => `"${escapeTomlBasicString(value)}"`).join(", ")}]`;
}

function disabledNxTaskMutationTools(capabilities: readonly AgentCapability[]): string[] {
  const tools = ["nx_task_close"];
  if (capabilities.includes("no_task_create")) {
    tools.push("nx_task_add");
  }
  if (capabilities.includes("no_task_update")) {
    tools.push("nx_task_update");
  }
  return tools;
}

function runtimeRestrictions(agent: AgentDefinition): {
  sandboxMode?: "read-only";
  includeApplyPatchTool?: boolean;
  nxDisabledTools: string[];
} {
  const noFileEdit = agent.capabilities.includes("no_file_edit");
  return {
    sandboxMode: noFileEdit ? "read-only" : undefined,
    includeApplyPatchTool: noFileEdit ? false : undefined,
    nxDisabledTools: disabledNxTaskMutationTools(agent.capabilities)
  };
}

export function generateStandaloneAgentToml(config: {
  name: string;
  description: string;
  developerInstructions: string;
  model: string;
  sandboxMode?: "read-only";
  includeApplyPatchTool?: boolean;
  nxDisabledTools?: string[];
}): string {
  const lines = [
    `name = "${escapeTomlBasicString(config.name)}"`,
    `description = "${escapeTomlBasicString(config.description)}"`,
    `model = "${escapeTomlBasicString(config.model)}"`,
    ...(config.sandboxMode ? [`sandbox_mode = "${escapeTomlBasicString(config.sandboxMode)}"`] : []),
    ...(typeof config.includeApplyPatchTool === "boolean"
      ? [`include_apply_patch_tool = ${config.includeApplyPatchTool ? "true" : "false"}`]
      : []),
    'developer_instructions = """',
    escapeTomlMultiline(config.developerInstructions),
    '"""',
    ...(config.nxDisabledTools && config.nxDisabledTools.length > 0
      ? [
          "",
          "[mcp_servers.nx]",
          `disabled_tools = ${formatTomlStringArray(config.nxDisabledTools)}`
        ]
      : []),
    ""
  ];
  return lines.join("\n");
}

export function generateAgentToml(agent: AgentDefinition, promptContent: string): string {
  const promptMetadata = parseAgentPromptMetadata(promptContent);
  const resolvedAgent = {
    ...agent,
    name: promptMetadata.name ?? agent.name,
    description: promptMetadata.description ?? agent.description,
    category: promptMetadata.category ?? agent.category
  } satisfies AgentDefinition;
  const restrictions = runtimeRestrictions(agent);
  return generateStandaloneAgentToml({
    name: resolvedAgent.name,
    description: resolvedAgent.description,
    developerInstructions: stripFrontmatter(promptContent),
    model: AGENT_MODEL_BY_CATEGORY[resolvedAgent.category],
    sandboxMode: restrictions.sandboxMode,
    includeApplyPatchTool: restrictions.includeApplyPatchTool,
    nxDisabledTools: restrictions.nxDisabledTools
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
