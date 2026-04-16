import { cp, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { installNativeAgentConfigs } from "../agents/native-config.js";
import { mergeManagedHooks } from "../config/codex-hooks.js";
import { mergeConfigToml } from "../config/toml.js";
import {
  AGENTS_MARKER_END,
  AGENTS_MARKER_START,
  ensureDir,
  ensureProjectGitignore,
  packageRoot,
  readTextIfExists,
  resolveScopePaths,
  type SetupScope,
  writeText
} from "../shared/paths.js";

export interface SetupOptions {
  scope: SetupScope;
}

export interface SetupResult {
  scope: SetupScope;
  projectRoot: string;
  codexHomeDir: string;
  skillsDir: string;
  agentsDir: string;
  configTomlPath: string;
  hooksJsonPath: string;
  agentsMdPath: string;
  installedSkills: string[];
  installedAgents: string[];
  wroteProjectGitignore: boolean;
}

async function copySkillDirectory(sourceDir: string, destinationDir: string): Promise<void> {
  await ensureDir(destinationDir);
  const entries = await readdir(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const destinationPath = path.join(destinationDir, entry.name);
    if (entry.isDirectory()) {
      await copySkillDirectory(sourcePath, destinationPath);
    } else {
      await cp(sourcePath, destinationPath, { force: true });
    }
  }
}

function mergeAgentsMd(existingContent: string | null, sectionContent: string): string {
  const wrapped = `${AGENTS_MARKER_START}\n${sectionContent.trim()}\n${AGENTS_MARKER_END}\n`;
  if (!existingContent || existingContent.trim().length === 0) {
    return wrapped;
  }

  const start = existingContent.indexOf(AGENTS_MARKER_START);
  const end = existingContent.indexOf(AGENTS_MARKER_END);
  if (start !== -1 && end !== -1 && end > start) {
    return (
      existingContent.slice(0, start) +
      wrapped +
      existingContent.slice(end + AGENTS_MARKER_END.length).replace(/^\n+/, "")
    );
  }

  const trimmed = existingContent.trimEnd();
  return `${trimmed}\n\n${wrapped}`;
}

export function formatSetupSummary(action: "setup" | "update", result: SetupResult, verbose: boolean): string {
  const lines = [
    action === "setup" ? "Setup complete." : "Update complete.",
    `Scope: ${result.scope}`,
    `Codex home: ${result.codexHomeDir}`
  ];

  if (action === "update") {
    lines.push("Refreshed managed Codex Nexus assets from the currently installed package version.");
  }

  lines.push(
    `Installed skills (${result.installedSkills.length}): ${result.installedSkills.join(", ")}`,
    `Installed agents (${result.installedAgents.length}): ${result.installedAgents.join(", ")}`
  );

  if (verbose) {
    lines.push(
      "Updated paths:",
      `- ${result.configTomlPath}`,
      `- ${result.hooksJsonPath}`,
      `- ${result.agentsMdPath}`
    );
    if (result.wroteProjectGitignore) {
      lines.push(`- ${result.projectRoot}/.gitignore`);
    }
  }

  return lines.join("\n");
}

export async function setupCommand(options: SetupOptions): Promise<SetupResult> {
  const pkgRoot = packageRoot();
  const scopePaths = resolveScopePaths(options.scope);

  await ensureDir(scopePaths.codexHomeDir);
  await ensureDir(scopePaths.skillsDir);
  await ensureDir(scopePaths.agentsDir);

  const shippedSkills = path.join(pkgRoot, "skills");
  const skillEntries = await readdir(shippedSkills, { withFileTypes: true });
  const installedSkills: string[] = [];
  for (const entry of skillEntries) {
    if (!entry.isDirectory()) continue;
    installedSkills.push(entry.name);
    await copySkillDirectory(
      path.join(shippedSkills, entry.name),
      path.join(scopePaths.skillsDir, entry.name)
    );
  }

  const installedAgents = await installNativeAgentConfigs(pkgRoot, scopePaths.agentsDir);

  const existingConfig = await readTextIfExists(scopePaths.configTomlPath);
  await writeText(scopePaths.configTomlPath, mergeConfigToml(existingConfig, pkgRoot));

  const existingHooks = await readTextIfExists(scopePaths.hooksJsonPath);
  await writeText(scopePaths.hooksJsonPath, mergeManagedHooks(existingHooks, pkgRoot));

  const template = await readFile(path.join(pkgRoot, "templates", "AGENTS.md"), "utf8");
  const existingAgentsMd = await readTextIfExists(scopePaths.agentsMdPath);
  await writeText(scopePaths.agentsMdPath, mergeAgentsMd(existingAgentsMd, template));

  let wroteProjectGitignore = false;
  if (scopePaths.scope === "project") {
    await ensureProjectGitignore(scopePaths.projectRoot);
    wroteProjectGitignore = true;
  }

  return {
    scope: scopePaths.scope,
    projectRoot: scopePaths.projectRoot,
    codexHomeDir: scopePaths.codexHomeDir,
    skillsDir: scopePaths.skillsDir,
    agentsDir: scopePaths.agentsDir,
    configTomlPath: scopePaths.configTomlPath,
    hooksJsonPath: scopePaths.hooksJsonPath,
    agentsMdPath: scopePaths.agentsMdPath,
    installedSkills: installedSkills.sort(),
    installedAgents: installedAgents.sort(),
    wroteProjectGitignore
  };
}
