import { existsSync } from "node:fs";
import { cp, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { mergeManagedHooks } from "../config/codex-hooks.js";
import { mergeConfigToml } from "../config/toml.js";
import {
  AGENTS_MARKER_END,
  AGENTS_MARKER_START,
  ensureDir,
  ensureProjectGitignore,
  readTextIfExists,
  resolveScopePaths,
  type ScopePaths,
  type SetupScope,
  writeText
} from "../shared/paths.js";

const PACKAGE_NAME = "codex-nexus";
const TEST_PACKAGE_ROOT_ENV = "CODEX_NEXUS_TEST_PACKAGE_ROOT";
const TEST_VERSIONS_ENV = "CODEX_NEXUS_TEST_VERSIONS";

export interface InstallOptions {
  scope: SetupScope;
  version: string;
  coreOnly: boolean;
}

export interface InstallResult {
  scope: SetupScope;
  requestedVersion: string;
  installedVersion: string;
  installedPackageRoot: string;
  projectRoot: string;
  codexHomeDir: string;
  packageStoreDir: string;
  skillsDir: string;
  agentsDir: string;
  configTomlPath: string;
  hooksJsonPath: string;
  agentsMdPath: string;
  installedSkills: string[];
  installedAgents: string[];
  configuredMcpServers: string[];
  wroteProjectGitignore: boolean;
}

function npmExecutable(): string {
  return process.platform === "win32" ? "npm.cmd" : "npm";
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

async function copyDirectory(sourceDir: string, destinationDir: string): Promise<void> {
  await ensureDir(destinationDir);
  const entries = await readdir(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const destinationPath = path.join(destinationDir, entry.name);
    if (entry.isDirectory()) {
      await copyDirectory(sourcePath, destinationPath);
    } else {
      await cp(sourcePath, destinationPath, { force: true });
    }
  }
}

function parseVersionsOverride(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.filter((value): value is string => typeof value === "string" && value.trim().length > 0);
    }
  } catch {
    // Fall through to comma-separated parsing.
  }

  return raw
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

async function runCommand(command: string, args: string[], cwd: string): Promise<string> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout.trim());
        return;
      }
      reject(new Error(stderr.trim() || `${command} ${args.join(" ")} exited with code ${code}`));
    });
  });
}

async function readInstalledPackageVersion(packageRootPath: string): Promise<string> {
  const raw = await readFile(path.join(packageRootPath, "package.json"), "utf8");
  const parsed = JSON.parse(raw) as { version?: unknown };
  if (typeof parsed.version !== "string" || parsed.version.trim().length === 0) {
    throw new Error(`Installed package at ${packageRootPath} is missing a valid version.`);
  }
  return parsed.version;
}

export async function fetchPublishedVersions(): Promise<string[]> {
  const override = process.env[TEST_VERSIONS_ENV];
  if (override) {
    return parseVersionsOverride(override);
  }

  const raw = await runCommand(npmExecutable(), ["view", PACKAGE_NAME, "versions", "--json"], process.cwd());
  const parsed = JSON.parse(raw) as unknown;
  if (Array.isArray(parsed)) {
    return parsed.filter((value): value is string => typeof value === "string" && value.trim().length > 0);
  }
  if (typeof parsed === "string" && parsed.trim().length > 0) {
    return [parsed];
  }
  return [];
}

async function resolveInstalledPackageRoot(scopePaths: ScopePaths, requestedVersion: string): Promise<string> {
  const override = process.env[TEST_PACKAGE_ROOT_ENV];
  if (override) {
    return path.resolve(override);
  }

  await ensureDir(scopePaths.packageStoreDir);
  const packageSpec = requestedVersion === "latest"
    ? PACKAGE_NAME
    : `${PACKAGE_NAME}@${requestedVersion}`;

  await runCommand(
    npmExecutable(),
    ["install", "--prefix", scopePaths.packageStoreDir, "--no-save", packageSpec],
    scopePaths.projectRoot
  );

  const installedRoot = path.join(scopePaths.packageStoreDir, "node_modules", PACKAGE_NAME);
  if (!existsSync(installedRoot)) {
    throw new Error(`Installed package not found at ${installedRoot}`);
  }
  return installedRoot;
}

async function writeManagedSurfaces(
  packageRootPath: string,
  scopePaths: ScopePaths,
  options: InstallOptions
): Promise<{
  installedSkills: string[];
  installedAgents: string[];
  configuredMcpServers: string[];
  wroteProjectGitignore: boolean;
}> {
  await ensureDir(scopePaths.codexHomeDir);
  await ensureDir(scopePaths.packageStoreDir);
  await ensureDir(scopePaths.skillsDir);
  await ensureDir(scopePaths.agentsDir);

  const shippedSkills = path.join(packageRootPath, "plugin", "skills");
  const skillEntries = await readdir(shippedSkills, { withFileTypes: true });
  const installedSkills: string[] = [];
  for (const entry of skillEntries) {
    if (!entry.isDirectory()) continue;
    installedSkills.push(entry.name);
    await copyDirectory(
      path.join(shippedSkills, entry.name),
      path.join(scopePaths.skillsDir, entry.name)
    );
  }

  const shippedAgentsDir = path.join(packageRootPath, "agents");
  const agentEntries = await readdir(shippedAgentsDir, { withFileTypes: true });
  const installedAgents: string[] = [];
  for (const entry of agentEntries) {
    if (!entry.isFile() || !entry.name.endsWith(".toml")) continue;
    installedAgents.push(entry.name.replace(/\.toml$/, ""));
    await cp(
      path.join(shippedAgentsDir, entry.name),
      path.join(scopePaths.agentsDir, entry.name),
      { force: true }
    );
  }

  const existingConfig = await readTextIfExists(scopePaths.configTomlPath);
  const mergedConfig = mergeConfigToml(existingConfig, packageRootPath, {
    coreOnly: options.coreOnly
  });
  await writeText(scopePaths.configTomlPath, mergedConfig);

  const existingHooks = await readTextIfExists(scopePaths.hooksJsonPath);
  await writeText(scopePaths.hooksJsonPath, mergeManagedHooks(existingHooks, packageRootPath));

  const template = await readFile(path.join(packageRootPath, "install", "AGENTS.fragment.md"), "utf8");
  const existingAgentsMd = await readTextIfExists(scopePaths.agentsMdPath);
  await writeText(scopePaths.agentsMdPath, mergeAgentsMd(existingAgentsMd, template));

  let wroteProjectGitignore = false;
  if (scopePaths.scope === "project") {
    await ensureProjectGitignore(scopePaths.projectRoot);
    wroteProjectGitignore = true;
  }

  return {
    installedSkills: installedSkills.sort(),
    installedAgents: installedAgents.sort(),
    configuredMcpServers: [
      "nx",
      ...(mergedConfig.includes("[mcp_servers.context7]") ? ["context7"] : [])
    ],
    wroteProjectGitignore
  };
}

export function formatInstallSummary(result: InstallResult, verbose: boolean): string {
  const lines = [
    "Install complete.",
    `Scope: ${result.scope}`,
    `Requested version: ${result.requestedVersion}`,
    `Installed version: ${result.installedVersion}`,
    `Codex home: ${result.codexHomeDir}`
  ];

  lines.push(
    `Installed skills (${result.installedSkills.length}): ${result.installedSkills.join(", ")}`,
    `Installed agents (${result.installedAgents.length}): ${result.installedAgents.join(", ")}`,
    `Configured MCP servers: ${result.configuredMcpServers.join(", ")}`
  );

  if (verbose) {
    lines.push(
      "Updated paths:",
      `- ${result.configTomlPath}`,
      `- ${result.hooksJsonPath}`,
      `- ${result.agentsMdPath}`,
      `- ${result.packageStoreDir}`,
      `- package root: ${result.installedPackageRoot}`
    );
    if (result.wroteProjectGitignore) {
      lines.push(`- ${result.projectRoot}/.gitignore`);
    }
  }

  return lines.join("\n");
}

export async function installCommand(options: InstallOptions): Promise<InstallResult> {
  const scopePaths = resolveScopePaths(options.scope);
  const requestedVersion = options.version.trim().length > 0 ? options.version.trim() : "latest";
  const installedPackageRoot = await resolveInstalledPackageRoot(scopePaths, requestedVersion);
  const installedVersion = await readInstalledPackageVersion(installedPackageRoot);
  const assets = await writeManagedSurfaces(installedPackageRoot, scopePaths, options);

  return {
    scope: scopePaths.scope,
    requestedVersion,
    installedVersion,
    installedPackageRoot,
    projectRoot: scopePaths.projectRoot,
    codexHomeDir: scopePaths.codexHomeDir,
    packageStoreDir: scopePaths.packageStoreDir,
    skillsDir: scopePaths.skillsDir,
    agentsDir: scopePaths.agentsDir,
    configTomlPath: scopePaths.configTomlPath,
    hooksJsonPath: scopePaths.hooksJsonPath,
    agentsMdPath: scopePaths.agentsMdPath,
    installedSkills: assets.installedSkills,
    installedAgents: assets.installedAgents,
    configuredMcpServers: assets.configuredMcpServers,
    wroteProjectGitignore: assets.wroteProjectGitignore
  };
}
