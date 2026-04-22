#!/usr/bin/env node

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { stdin as input, stdout as output } from "node:process";
import TOML from "@iarna/toml";
import { intro, isCancel, outro, select, spinner } from "@clack/prompts";

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGE_JSON = JSON.parse(readFileSync(path.join(PACKAGE_ROOT, "package.json"), "utf8"));
const PACKAGE_NAME = PACKAGE_JSON.name;
const PACKAGE_VERSION = PACKAGE_JSON.version;
const PLUGIN_NAME = "codex-nexus";
const LEAD_INSTRUCTIONS_FILE = "lead.instructions.md";
const TEST_PACKAGE_ROOT_ENV = "CODEX_NEXUS_TEST_PACKAGE_ROOT";
const TEST_VERSIONS_ENV = "CODEX_NEXUS_TEST_VERSIONS";
const MIN_COMPATIBLE_VERSION = "0.3.0";

function safeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function parseSemver(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(version.trim());
  if (!match) {
    return null;
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3])
  };
}

function compareSemver(left, right) {
  const a = parseSemver(left);
  const b = parseSemver(right);
  if (!a || !b) {
    throw new Error(`Unable to compare versions "${left}" and "${right}".`);
  }

  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

function isCompatibleVersion(version) {
  return compareSemver(version, MIN_COMPATIBLE_VERSION) >= 0;
}

function npmExecutable() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function normalizeScope(scope) {
  if (scope === "user" || scope === "project") {
    return scope;
  }
  return null;
}

function isInteractiveTerminal() {
  if (process.env.CODEX_NEXUS_FORCE_TTY === "1") {
    return true;
  }
  if (process.env.CODEX_NEXUS_FORCE_TTY === "0") {
    return false;
  }
  return Boolean(input.isTTY) && Boolean(output.isTTY);
}

function findProjectRoot(startDir = process.cwd()) {
  let current = path.resolve(startDir);
  while (true) {
    if (existsSync(path.join(current, ".git"))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return path.resolve(startDir);
    }
    current = parent;
  }
}

function ensureDir(dirPath) {
  mkdirSync(dirPath, { recursive: true });
}

function writeText(filePath, content) {
  ensureDir(path.dirname(filePath));
  writeFileSync(filePath, content, "utf8");
}

function readTextIfExists(filePath) {
  return existsSync(filePath) ? readFileSync(filePath, "utf8") : null;
}

function ensureProjectGitignore(projectRoot) {
  const gitignorePath = path.join(projectRoot, ".gitignore");
  const requiredLines = [
    ".nexus/state/",
    ".codex/config.toml",
    ".codex/hooks.json",
    ".codex/packages/"
  ];

  const existing = readTextIfExists(gitignorePath) ?? "";
  const lines = new Set(existing.split(/\r?\n/).filter(Boolean));
  let changed = false;

  for (const line of requiredLines) {
    if (!lines.has(line)) {
      lines.add(line);
      changed = true;
    }
  }

  if (changed || !existsSync(gitignorePath)) {
    writeText(gitignorePath, `${Array.from(lines).join("\n")}\n`);
  }
}

function copyDirectory(sourceDir, destinationDir) {
  rmSync(destinationDir, { recursive: true, force: true });
  ensureDir(path.dirname(destinationDir));
  cpSync(sourceDir, destinationDir, { recursive: true });
}

function resolveHomeDir(env) {
  return env.HOME ?? os.homedir();
}

function resolveScopePaths(scope, cwd = process.cwd(), env = process.env) {
  const projectRoot = findProjectRoot(cwd);
  const homeDir = resolveHomeDir(env);
  const codexHomeDir = scope === "user"
    ? path.resolve(env.CODEX_HOME ?? path.join(homeDir, ".codex"))
    : path.join(projectRoot, ".codex");
  const agentsRootDir = scope === "user"
    ? path.join(homeDir, ".agents")
    : path.join(projectRoot, ".agents");
  const packageStoreDir = path.join(codexHomeDir, "packages");
  const pluginInstallDir = scope === "user"
    ? path.join(codexHomeDir, "plugins", PLUGIN_NAME)
    : path.join(projectRoot, "plugins", PLUGIN_NAME);

  return {
    scope,
    projectRoot,
    codexHomeDir,
    agentsRootDir,
    packageStoreDir,
    configTomlPath: path.join(codexHomeDir, "config.toml"),
    hooksJsonPath: path.join(codexHomeDir, "hooks.json"),
    leadInstructionsPath: path.join(codexHomeDir, LEAD_INSTRUCTIONS_FILE),
    agentsDir: path.join(codexHomeDir, "agents"),
    skillsDir: path.join(agentsRootDir, "skills"),
    marketplacePath: path.join(agentsRootDir, "plugins", "marketplace.json"),
    pluginInstallDir,
    pluginSourcePath: scope === "user" ? "./.codex/plugins/codex-nexus" : "./plugins/codex-nexus"
  };
}

function parseVersionsOverride(raw) {
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((value) => typeof value === "string" && value.trim().length > 0);
    }
  } catch {
    // Fall through to comma-delimited parsing.
  }

  return raw
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

async function runCommand(command, args, cwd, env = process.env) {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdoutText = "";
    let stderrText = "";
    child.stdout.on("data", (chunk) => {
      stdoutText += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderrText += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdoutText.trim());
        return;
      }
      reject(new Error(stderrText.trim() || `${command} ${args.join(" ")} exited with code ${code}`));
    });
  });
}

async function fetchPublishedVersions(runtime = {}) {
  const env = runtime.env ?? process.env;
  const override = env[TEST_VERSIONS_ENV];
  if (override) {
    return parseVersionsOverride(override).filter((value) => isCompatibleVersion(value));
  }

  const raw = await runCommand(npmExecutable(), ["view", PACKAGE_NAME, "versions", "--json"], runtime.cwd ?? process.cwd(), env);
  const parsed = JSON.parse(raw);

  if (Array.isArray(parsed)) {
    return parsed
      .filter((value) => typeof value === "string" && value.trim().length > 0)
      .filter((value) => isCompatibleVersion(value));
  }
  if (typeof parsed === "string" && parsed.trim().length > 0 && isCompatibleVersion(parsed)) {
    return [parsed];
  }
  return [];
}

async function readInstalledPackageVersion(packageRoot) {
  const parsed = JSON.parse(readFileSync(path.join(packageRoot, "package.json"), "utf8"));
  if (typeof parsed.version !== "string" || parsed.version.trim().length === 0) {
    throw new Error(`Installed package at ${packageRoot} is missing a valid version.`);
  }
  return parsed.version;
}

function resolveNexusCoreVersion(packageRoot) {
  const pluginMcpPath = path.join(packageRoot, "plugins", PLUGIN_NAME, ".mcp.json");
  if (existsSync(pluginMcpPath)) {
    const parsed = JSON.parse(readFileSync(pluginMcpPath, "utf8"));
    const args = parsed?.mcpServers?.nx?.args;
    if (Array.isArray(args)) {
      const packageArg = args.find((entry) => typeof entry === "string" && entry.startsWith("@moreih29/nexus-core@"));
      if (packageArg) {
        return packageArg.slice("@moreih29/nexus-core@".length);
      }
    }
  }

  const parsed = JSON.parse(readFileSync(path.join(packageRoot, "package.json"), "utf8"));
  const packageSpec = parsed?.dependencies?.["@moreih29/nexus-core"] ??
    parsed?.devDependencies?.["@moreih29/nexus-core"] ??
    parsed?.peerDependencies?.["@moreih29/nexus-core"];

  if (typeof packageSpec === "string" && packageSpec.trim().length > 0) {
    return packageSpec.trim();
  }

  throw new Error(`Unable to determine pinned @moreih29/nexus-core version from ${packageRoot}`);
}

async function resolveInstalledPackageRoot(scopePaths, requestedVersion, runtime = {}) {
  const env = runtime.env ?? process.env;
  const override = env[TEST_PACKAGE_ROOT_ENV];
  if (override) {
    return path.resolve(override);
  }

  ensureDir(scopePaths.packageStoreDir);

  const packageSpec = requestedVersion === "latest"
    ? PACKAGE_NAME
    : `${PACKAGE_NAME}@${requestedVersion}`;

  await runCommand(
    npmExecutable(),
    ["install", "--prefix", scopePaths.packageStoreDir, "--no-save", packageSpec],
    scopePaths.projectRoot,
    env
  );

  const installedRoot = path.join(scopePaths.packageStoreDir, "node_modules", PACKAGE_NAME);
  if (!existsSync(installedRoot)) {
    throw new Error(`Installed package not found at ${installedRoot}`);
  }
  return installedRoot;
}

function quotePathForShell(filePath) {
  return `"${filePath.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"")}"`;
}

function buildManagedHooks(installedPackageRoot) {
  const hookScriptPath = path.join(installedPackageRoot, "scripts", "codex-nexus-hook.mjs");
  const quotedHookScriptPath = quotePathForShell(hookScriptPath);

  return {
    hooks: {
      SessionStart: [
        {
          matcher: "startup|resume|clear",
          hooks: [
            {
              type: "command",
              command: `node ${quotedHookScriptPath} session-start`,
              timeout: 30
            }
          ]
        }
      ],
      UserPromptSubmit: [
        {
          hooks: [
            {
              type: "command",
              command: `node ${quotedHookScriptPath} user-prompt-submit`,
              timeout: 30
            }
          ]
        }
      ],
      PreToolUse: [
        {
          matcher: "Bash",
          hooks: [
            {
              type: "command",
              command: `node ${quotedHookScriptPath} pre-tool-use`,
              timeout: 30
            }
          ]
        }
      ]
    }
  };
}

function isManagedHookCommand(command) {
  return typeof command === "string" && /codex-nexus-hook/.test(command);
}

function stripManagedHookGroup(group) {
  if (!group || typeof group !== "object" || !Array.isArray(group.hooks)) {
    return group;
  }

  const nextHooks = group.hooks.filter((hook) => !(hook?.type === "command" && isManagedHookCommand(hook.command)));
  if (nextHooks.length === 0) {
    return null;
  }

  return {
    ...group,
    hooks: nextHooks
  };
}

function mergeHooksJson(existingContent, installedPackageRoot) {
  const parsed = existingContent ? JSON.parse(existingContent) : {};
  const next = {
    ...parsed,
    hooks: {
      ...safeObject(parsed.hooks)
    }
  };
  const managed = buildManagedHooks(installedPackageRoot);

  for (const [eventName, groups] of Object.entries(managed.hooks)) {
    const existingGroups = Array.isArray(next.hooks[eventName]) ? next.hooks[eventName] : [];
    const preserved = existingGroups
      .map((group) => stripManagedHookGroup(group))
      .filter((group) => group !== null);
    next.hooks[eventName] = [...preserved, ...groups];
  }

  return JSON.stringify(next, null, 2) + "\n";
}

function managedNxServerConfig(nexusCoreVersion) {
  return {
    command: "npx",
    args: ["-y", "-p", `@moreih29/nexus-core@${nexusCoreVersion}`, "nexus-mcp"]
  };
}

function mergeConfigToml(existingContent, nexusCoreVersion) {
  const parsed = existingContent ? TOML.parse(existingContent) : {};
  const features = safeObject(parsed.features);
  const mcpServers = safeObject(parsed.mcp_servers);

  parsed.model_instructions_file = LEAD_INSTRUCTIONS_FILE;
  parsed.features = {
    ...features,
    multi_agent: true,
    child_agents_md: true,
    codex_hooks: true
  };
  parsed.mcp_servers = {
    ...mcpServers,
    nx: managedNxServerConfig(nexusCoreVersion)
  };

  return TOML.stringify(parsed);
}

function mergeMarketplaceJson(existingContent, pluginSourcePath) {
  const parsed = existingContent ? JSON.parse(existingContent) : {};
  const marketplace = {
    name: typeof parsed.name === "string" && parsed.name.trim().length > 0 ? parsed.name : "codex-nexus",
    interface: {
      displayName: safeObject(parsed.interface).displayName ?? "Codex Nexus"
    },
    plugins: Array.isArray(parsed.plugins) ? parsed.plugins : []
  };

  const nextEntry = {
    name: PLUGIN_NAME,
    source: {
      source: "local",
      path: pluginSourcePath
    },
    policy: {
      installation: "AVAILABLE",
      authentication: "ON_INSTALL"
    },
    category: "Coding"
  };

  const existingIndex = marketplace.plugins.findIndex((entry) => entry?.name === PLUGIN_NAME);
  if (existingIndex === -1) {
    marketplace.plugins.push(nextEntry);
  } else {
    marketplace.plugins[existingIndex] = nextEntry;
  }

  return JSON.stringify(marketplace, null, 2) + "\n";
}

async function installManagedSurfaces(installedPackageRoot, scopePaths) {
  const pluginSourceRoot = path.join(installedPackageRoot, "plugins", PLUGIN_NAME);
  const nexusCoreVersion = resolveNexusCoreVersion(installedPackageRoot);

  copyDirectory(pluginSourceRoot, scopePaths.pluginInstallDir);
  copyDirectory(path.join(pluginSourceRoot, "agents"), scopePaths.agentsDir);
  copyDirectory(path.join(pluginSourceRoot, "skills"), scopePaths.skillsDir);
  writeText(
    scopePaths.leadInstructionsPath,
    readFileSync(path.join(pluginSourceRoot, LEAD_INSTRUCTIONS_FILE), "utf8")
  );
  writeText(
    scopePaths.configTomlPath,
    mergeConfigToml(readTextIfExists(scopePaths.configTomlPath), nexusCoreVersion)
  );
  writeText(
    scopePaths.hooksJsonPath,
    mergeHooksJson(readTextIfExists(scopePaths.hooksJsonPath), installedPackageRoot)
  );
  writeText(
    scopePaths.marketplacePath,
    mergeMarketplaceJson(readTextIfExists(scopePaths.marketplacePath), scopePaths.pluginSourcePath)
  );
  if (scopePaths.scope === "project") {
    ensureProjectGitignore(scopePaths.projectRoot);
  }

  return {
    nexusCoreVersion
  };
}

async function installCommand(options = {}, runtime = {}) {
  const scope = normalizeScope(options.scope) ?? "user";
  const cwd = runtime.cwd ?? process.cwd();
  const env = runtime.env ?? process.env;
  const scopePaths = resolveScopePaths(scope, cwd, env);
  const requestedVersion = typeof options.version === "string" && options.version.trim().length > 0
    ? options.version.trim()
    : "latest";

  if (requestedVersion !== "latest" && !isCompatibleVersion(requestedVersion)) {
    throw new Error(
      `codex-nexus ${requestedVersion} is not compatible with this installer. Minimum compatible version is ${MIN_COMPATIBLE_VERSION}.`
    );
  }

  const installedPackageRoot = await resolveInstalledPackageRoot(scopePaths, requestedVersion, runtime);
  const installedVersion = await readInstalledPackageVersion(installedPackageRoot);

  if (!isCompatibleVersion(installedVersion)) {
    throw new Error(
      `Resolved codex-nexus ${installedVersion}, but this installer requires ${MIN_COMPATIBLE_VERSION} or newer. Publish or select a compatible version first.`
    );
  }

  const assets = await installManagedSurfaces(installedPackageRoot, scopePaths);

  return {
    scope,
    requestedVersion,
    installedVersion,
    installedPackageRoot,
    projectRoot: scopePaths.projectRoot,
    codexHomeDir: scopePaths.codexHomeDir,
    packageStoreDir: scopePaths.packageStoreDir,
    marketplacePath: scopePaths.marketplacePath,
    pluginInstallDir: scopePaths.pluginInstallDir,
    configTomlPath: scopePaths.configTomlPath,
    hooksJsonPath: scopePaths.hooksJsonPath,
    leadInstructionsPath: scopePaths.leadInstructionsPath,
    agentsDir: scopePaths.agentsDir,
    skillsDir: scopePaths.skillsDir,
    nexusCoreVersion: assets.nexusCoreVersion
  };
}

function doctorCommand(options = {}, runtime = {}) {
  const scope = normalizeScope(options.scope) ?? "user";
  const cwd = runtime.cwd ?? process.cwd();
  const env = runtime.env ?? process.env;
  const paths = resolveScopePaths(scope, cwd, env);
  const config = readTextIfExists(paths.configTomlPath) ?? "";
  const hooks = readTextIfExists(paths.hooksJsonPath) ?? "";
  const marketplace = readTextIfExists(paths.marketplacePath) ?? "";
  const hasManagedHooks = /codex-nexus-hook[^\n]*session-start/.test(hooks);
  const packageStoreRoot = env[TEST_PACKAGE_ROOT_ENV]
    ? path.resolve(env[TEST_PACKAGE_ROOT_ENV])
    : path.join(paths.packageStoreDir, "node_modules", PACKAGE_NAME);
  const usesLocalDevelopmentHooks = hooks.includes(path.join(PACKAGE_ROOT, "scripts", "codex-nexus-hook.mjs")) ||
    hooks.includes("node ./scripts/codex-nexus-hook.mjs");

  const checks = [
    { label: "plugin install dir", ok: existsSync(path.join(paths.pluginInstallDir, ".codex-plugin", "plugin.json")) },
    { label: "lead instructions", ok: existsSync(paths.leadInstructionsPath) },
    { label: "config.toml", ok: existsSync(paths.configTomlPath) && config.includes('model_instructions_file = "lead.instructions.md"') && config.includes("[mcp_servers.nx]") },
    { label: "hooks.json", ok: existsSync(paths.hooksJsonPath) && hasManagedHooks },
    { label: "marketplace.json", ok: existsSync(paths.marketplacePath) && marketplace.includes(paths.pluginSourcePath) },
    { label: ".codex/agents/lead.toml", ok: existsSync(path.join(paths.agentsDir, "lead.toml")) },
    { label: ".agents/skills/nx-plan", ok: existsSync(path.join(paths.skillsDir, "nx-plan", "SKILL.md")) },
    { label: "package store", ok: usesLocalDevelopmentHooks || existsSync(path.join(packageStoreRoot, "package.json")) }
  ];

  return {
    scope,
    failed: checks.filter((check) => !check.ok).length,
    checks
  };
}

function formatInstallSummary(result) {
  return [
    "codex-nexus install complete",
    `scope: ${result.scope}`,
    `requested version: ${result.requestedVersion}`,
    `installed version: ${result.installedVersion}`,
    `nexus-core version: ${result.nexusCoreVersion}`,
    `package store: ${result.packageStoreDir}`,
    `plugin: ${result.pluginInstallDir}`,
    `config: ${result.configTomlPath}`,
    `hooks: ${result.hooksJsonPath}`,
    `marketplace: ${result.marketplacePath}`,
    `lead instructions: ${result.leadInstructionsPath}`,
    `agents: ${result.agentsDir}`,
    `skills: ${result.skillsDir}`
  ].join("\n");
}

function formatDoctorSummary(result) {
  const lines = [`codex-nexus doctor (${result.scope})`];
  for (const check of result.checks) {
    lines.push(`${check.ok ? "[ok]" : "[xx]"} ${check.label}`);
  }
  lines.push(result.failed === 0 ? "Doctor passed." : `Doctor found ${result.failed} issue(s).`);
  return lines.join("\n");
}

function parseArgs(argv) {
  const [, , command, ...rest] = argv;
  if (command === "--help" || command === "-h" || command === "help" || command === undefined) {
    return {
      command,
      options: { help: true }
    };
  }
  const options = {};

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (token === "--scope" && rest[index + 1]) {
      options.scope = rest[index + 1];
      index += 1;
      continue;
    }
    if (token.startsWith("--scope=")) {
      options.scope = token.slice("--scope=".length);
      continue;
    }
    if (token === "--version" && rest[index + 1]) {
      options.version = rest[index + 1];
      index += 1;
      continue;
    }
    if (token.startsWith("--version=")) {
      options.version = token.slice("--version=".length);
      continue;
    }
    if (token === "--help" || token === "-h") {
      options.help = true;
      continue;
    }
  }

  return {
    command,
    options
  };
}

async function promptScope(command, defaultValue = "user") {
  const selection = await select({
    message: command === "doctor"
      ? "Which installation scope do you want to inspect?"
      : "Which installation scope do you want to install into?",
    initialValue: defaultValue,
    options: [
      { value: "user", label: "user", hint: "~/.codex and ~/.agents" },
      { value: "project", label: "project", hint: "Current repository only" }
    ]
  });

  if (isCancel(selection)) {
    throw new Error("Interrupted");
  }
  return selection;
}

async function promptVersion(versions) {
  if (versions.length === 0) {
    throw new Error(
      `No compatible published codex-nexus versions were found. Minimum compatible version is ${MIN_COMPATIBLE_VERSION}.`
    );
  }

  const descending = [...versions].reverse();
  const latestVersion = descending[0];

  const mode = await select({
    message: "Which codex-nexus version do you want to install?",
    initialValue: "latest",
    options: [
      { value: "latest", label: "latest", hint: latestVersion },
      { value: "specific", label: "choose a published version" }
    ]
  });

  if (isCancel(mode)) {
    throw new Error("Interrupted");
  }

  if (mode === "latest") {
    return "latest";
  }

  const selectedVersion = await select({
    message: "Select a published codex-nexus version",
    initialValue: latestVersion,
    options: descending.map((version, index) => ({
      value: version,
      label: version,
      hint: index === 0 ? "Latest published" : undefined
    }))
  });

  if (isCancel(selectedVersion)) {
    throw new Error("Interrupted");
  }

  return selectedVersion;
}

async function resolveInstallOptions(parsed, runtime = {}) {
  const interactive = isInteractiveTerminal();
  const options = { ...parsed.options };

  if (options.scope && !normalizeScope(options.scope)) {
    throw new Error(`Invalid --scope value "${options.scope}". Expected "user" or "project".`);
  }

  if (!options.version && interactive) {
    const s = spinner();
    s.start("Fetching published codex-nexus versions");
    try {
      const versions = await fetchPublishedVersions(runtime);
      s.stop("Fetched published versions");
      options.version = await promptVersion(versions);
    } catch (error) {
      s.stop("Failed to fetch published versions");
      throw error;
    }
  } else if (!options.version) {
    options.version = PACKAGE_VERSION;
  }

  if (!options.scope && interactive) {
    options.scope = await promptScope("install");
  } else if (!options.scope) {
    options.scope = "user";
  }

  return options;
}

async function resolveDoctorOptions(parsed) {
  const interactive = isInteractiveTerminal();
  const options = { ...parsed.options };

  if (options.scope && !normalizeScope(options.scope)) {
    throw new Error(`Invalid --scope value "${options.scope}". Expected "user" or "project".`);
  }

  if (!options.scope && interactive) {
    options.scope = await promptScope("doctor");
  } else if (!options.scope) {
    options.scope = "user";
  }

  return options;
}

function printHelp() {
  process.stdout.write(`codex-nexus

Usage:
  codex-nexus install [--scope user|project] [--version <version|latest>]
  codex-nexus doctor [--scope user|project]
`);
}

async function runCli(argv = process.argv, runtime = {}) {
  const parsed = parseArgs(argv);

  if (parsed.options.help || parsed.command === "help" || parsed.command === undefined) {
    printHelp();
    return 0;
  }

  if (parsed.command === "doctor") {
    const options = await resolveDoctorOptions(parsed);
    const result = doctorCommand(options, runtime);
    process.stdout.write(formatDoctorSummary(result) + "\n");
    return result.failed === 0 ? 0 : 1;
  }

  if (parsed.command === "install") {
    const interactive = isInteractiveTerminal();
    if (interactive) {
      intro("codex-nexus install");
    }

    const options = await resolveInstallOptions(parsed, runtime);
    const s = interactive ? spinner() : null;

    try {
      if (s) {
        s.start("Installing codex-nexus");
      }
      const result = await installCommand(options, runtime);
      if (s) {
        s.stop("Install complete");
        outro(formatInstallSummary(result));
      } else {
        process.stdout.write(formatInstallSummary(result) + "\n");
      }
      return 0;
    } catch (error) {
      if (s) {
        s.stop("Install failed");
      }
      throw error;
    }
  }

  process.stderr.write(`Unknown command: ${parsed.command}\n`);
  printHelp();
  return 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = await runCli();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

export {
  doctorCommand,
  fetchPublishedVersions,
  formatDoctorSummary,
  formatInstallSummary,
  installCommand,
  mergeConfigToml,
  mergeHooksJson,
  mergeMarketplaceJson,
  resolveInstalledPackageRoot,
  resolveNexusCoreVersion,
  resolveScopePaths,
  runCli
};
