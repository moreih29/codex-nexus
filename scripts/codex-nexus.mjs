#!/usr/bin/env node

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
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
const NEXUS_CORE_SERVER_RELATIVE_PATH = path.join("dist", "mcp", "server.js");

function safeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
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

function resolveRuntimeCommand() {
  return process.execPath;
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
    ".codex/",
    ".agents/"
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

function resolveNexusCorePackageRoot(packageRoot) {
  const candidates = [
    path.join(packageRoot, "node_modules", "@moreih29", "nexus-core"),
    path.join(packageRoot, "..", "@moreih29", "nexus-core")
  ];

  for (const candidate of candidates) {
    if (existsSync(path.join(candidate, "package.json"))) {
      return path.resolve(candidate);
    }
  }

  throw new Error(`Unable to resolve installed @moreih29/nexus-core package root from ${packageRoot}`);
}

function resolveNexusCoreServerPath(packageRoot) {
  const nexusCorePackageRoot = resolveNexusCorePackageRoot(packageRoot);
  const serverPath = path.join(nexusCorePackageRoot, NEXUS_CORE_SERVER_RELATIVE_PATH);

  if (!existsSync(serverPath)) {
    throw new Error(`Unable to resolve installed nexus-mcp server entry at ${serverPath}`);
  }

  return path.resolve(serverPath);
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

function managedInstalledNxServerConfig(runtimeCommand, serverPath) {
  return {
    command: runtimeCommand,
    args: [serverPath]
  };
}

function mergeAgentNxServerConfigToml(content, runtimeCommand, serverPath) {
  const parsed = TOML.parse(content);
  const mcpServers = safeObject(parsed.mcp_servers);
  const nxConfig = safeObject(mcpServers.nx);

  if (Object.keys(nxConfig).length === 0) {
    return content;
  }

  parsed.mcp_servers = {
    ...mcpServers,
    nx: {
      ...nxConfig,
      ...managedInstalledNxServerConfig(runtimeCommand, serverPath)
    }
  };

  return TOML.stringify(parsed);
}

function rewriteManagedAgentNxServerConfigs(agentDir, runtimeCommand, serverPath) {
  if (!existsSync(agentDir)) {
    return;
  }

  for (const entry of readdirSync(agentDir).filter((name) => name.endsWith(".toml"))) {
    const filePath = path.join(agentDir, entry);
    const current = readFileSync(filePath, "utf8");
    const next = mergeAgentNxServerConfigToml(current, runtimeCommand, serverPath);

    if (next !== current) {
      writeText(filePath, next);
    }
  }
}

function readAgentNxServerConfigs(agentDir) {
  if (!existsSync(agentDir)) {
    return [];
  }

  return readdirSync(agentDir)
    .filter((entry) => entry.endsWith(".toml"))
    .map((entry) => {
      const filePath = path.join(agentDir, entry);
      const parsed = TOML.parse(readFileSync(filePath, "utf8"));
      const nxConfig = safeObject(safeObject(parsed.mcp_servers).nx);

      return {
        file: entry,
        command: typeof nxConfig.command === "string" ? nxConfig.command : "",
        args: Array.isArray(nxConfig.args) ? nxConfig.args : [],
        disabledTools: Array.isArray(nxConfig.disabled_tools) ? nxConfig.disabled_tools : []
      };
    })
    .filter((entry) => entry.command.length > 0 || entry.args.length > 0 || entry.disabledTools.length > 0);
}

function mergeConfigToml(existingContent, runtimeCommand, serverPath) {
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
    nx: managedInstalledNxServerConfig(runtimeCommand, serverPath)
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
  const runtimeCommand = resolveRuntimeCommand();
  const nexusCoreServerPath = resolveNexusCoreServerPath(installedPackageRoot);

  copyDirectory(pluginSourceRoot, scopePaths.pluginInstallDir);
  rewriteManagedAgentNxServerConfigs(path.join(scopePaths.pluginInstallDir, "agents"), runtimeCommand, nexusCoreServerPath);
  copyDirectory(path.join(pluginSourceRoot, "agents"), scopePaths.agentsDir);
  rewriteManagedAgentNxServerConfigs(scopePaths.agentsDir, runtimeCommand, nexusCoreServerPath);
  copyDirectory(path.join(pluginSourceRoot, "skills"), scopePaths.skillsDir);
  writeText(
    scopePaths.leadInstructionsPath,
    readFileSync(path.join(pluginSourceRoot, LEAD_INSTRUCTIONS_FILE), "utf8")
  );
  writeText(
    scopePaths.configTomlPath,
    mergeConfigToml(readTextIfExists(scopePaths.configTomlPath), runtimeCommand, nexusCoreServerPath)
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
    nexusCoreVersion,
    runtimeCommand,
    nexusCoreServerPath
  };
}

async function installCommand(options = {}, runtime = {}) {
  const scope = normalizeScope(options.scope) ?? "user";
  const cwd = runtime.cwd ?? process.cwd();
  const env = runtime.env ?? process.env;
  const scopePaths = resolveScopePaths(scope, cwd, env);
  const requestedVersion = PACKAGE_VERSION;
  const installedPackageRoot = await resolveInstalledPackageRoot(scopePaths, requestedVersion, runtime);
  const installedVersion = await readInstalledPackageVersion(installedPackageRoot);

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
    nexusCoreVersion: assets.nexusCoreVersion,
    runtimeCommand: assets.runtimeCommand,
    nexusCoreServerPath: assets.nexusCoreServerPath
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
  const parsedConfig = config ? TOML.parse(config) : {};
  const nxConfig = safeObject(safeObject(parsedConfig.mcp_servers).nx);
  const nxCommand = typeof nxConfig.command === "string" ? nxConfig.command : "";
  const nxArgs = Array.isArray(nxConfig.args) ? nxConfig.args : [];
  const nxServerPath = typeof nxArgs[0] === "string" ? nxArgs[0] : "";
  const hasManagedHooks = /codex-nexus-hook[^\n]*session-start/.test(hooks);
  const packageStoreRoot = env[TEST_PACKAGE_ROOT_ENV]
    ? path.resolve(env[TEST_PACKAGE_ROOT_ENV])
    : path.join(paths.packageStoreDir, "node_modules", PACKAGE_NAME);
  const usesLocalDevelopmentHooks = hooks.includes(path.join(PACKAGE_ROOT, "scripts", "codex-nexus-hook.mjs")) ||
    hooks.includes("node ./scripts/codex-nexus-hook.mjs");
  const installedAgentNxConfigs = readAgentNxServerConfigs(paths.agentsDir);
  const installedPluginAgentNxConfigs = readAgentNxServerConfigs(path.join(paths.pluginInstallDir, "agents"));
  const usesResolvedNxLauncher = (agentConfigs) => agentConfigs.length > 0 &&
    agentConfigs.every((agent) =>
      agent.command.length > 0 &&
      agent.command !== "nexus-mcp" &&
      existsSync(agent.command) &&
      agent.args.length > 0 &&
      typeof agent.args[0] === "string" &&
      existsSync(agent.args[0])
    );

  const checks = [
    { label: "plugin install dir", ok: existsSync(path.join(paths.pluginInstallDir, ".codex-plugin", "plugin.json")) },
    { label: "lead instructions", ok: existsSync(paths.leadInstructionsPath) },
    {
      label: "config.toml",
      ok:
        existsSync(paths.configTomlPath) &&
        config.includes('model_instructions_file = "lead.instructions.md"') &&
        config.includes("[mcp_servers.nx]") &&
        nxCommand.length > 0 &&
        existsSync(nxCommand) &&
        nxServerPath.length > 0 &&
        existsSync(nxServerPath)
    },
    { label: "hooks.json", ok: existsSync(paths.hooksJsonPath) && hasManagedHooks },
    { label: "marketplace.json", ok: existsSync(paths.marketplacePath) && marketplace.includes(paths.pluginSourcePath) },
    { label: ".codex/agents/lead.toml", ok: existsSync(path.join(paths.agentsDir, "lead.toml")) },
    { label: ".codex/agents use resolved nx MCP launcher", ok: usesResolvedNxLauncher(installedAgentNxConfigs) },
    { label: "plugin agents use resolved nx MCP launcher", ok: usesResolvedNxLauncher(installedPluginAgentNxConfigs) },
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
    `runtime command: ${result.runtimeCommand}`,
    `nexus-mcp entry: ${result.nexusCoreServerPath}`,
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
    if (token === "--help" || token === "-h") {
      options.help = true;
      continue;
    }
    throw new Error(`Unknown option "${token}". Version selection should be done at invocation time, for example: npx -y codex-nexus@${PACKAGE_VERSION} install`);
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

async function resolveInstallOptions(parsed, runtime = {}) {
  const interactive = isInteractiveTerminal();
  const options = { ...parsed.options };

  if (options.scope && !normalizeScope(options.scope)) {
    throw new Error(`Invalid --scope value "${options.scope}". Expected "user" or "project".`);
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
  codex-nexus install [--scope user|project]
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

if (import.meta.main) {
  try {
    process.exitCode = await runCli();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

export {
  doctorCommand,
  formatDoctorSummary,
  formatInstallSummary,
  installCommand,
  mergeConfigToml,
  mergeHooksJson,
  mergeMarketplaceJson,
  resolveInstalledPackageRoot,
  resolveNexusCorePackageRoot,
  resolveNexusCoreServerPath,
  resolveNexusCoreVersion,
  resolveScopePaths,
  runCli
};
