#!/usr/bin/env node

import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
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
const INSTALL_STATE_DIRNAME = ".codex-nexus";
const INSTALL_STATE_FILENAME = "install-state.json";
const INSTALL_STATE_VERSION = 1;
const MANAGED_GITIGNORE_LINES = [
  ".nexus/state/",
  ".codex/",
  ".agents/"
];
const MANAGED_FEATURE_KEYS = ["multi_agent", "child_agents_md", "codex_hooks"];
const DEFAULT_MARKETPLACE_NAME = "codex-nexus";
const DEFAULT_MARKETPLACE_DISPLAY_NAME = "Codex Nexus";
const STABLE_INLINE_HOOKS_MIN_CODEX_VERSION = "0.124.0";
const HOOK_SURFACE_INLINE = "config.toml";
const HOOK_SURFACE_JSON = "hooks.json";
const MANAGED_TOOL_HOOK_MATCHER = "^(Bash|apply_patch|Edit|Write|mcp__.*)$";

function safeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function objectHas(record, key) {
  return Object.prototype.hasOwnProperty.call(record, key);
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

function writeJson(filePath, value) {
  writeText(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function readTextIfExists(filePath) {
  return existsSync(filePath) ? readFileSync(filePath, "utf8") : null;
}

function readJsonIfExists(filePath) {
  const content = readTextIfExists(filePath);
  return content ? JSON.parse(content) : null;
}

function removePath(filePath) {
  rmSync(filePath, { recursive: true, force: true });
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
  const managedStateDir = path.join(codexHomeDir, INSTALL_STATE_DIRNAME);

  return {
    scope,
    projectRoot,
    codexHomeDir,
    agentsRootDir,
    packageStoreDir,
    managedInstalledPackageRoot: path.join(packageStoreDir, "node_modules", PACKAGE_NAME),
    configTomlPath: path.join(codexHomeDir, "config.toml"),
    hooksJsonPath: path.join(codexHomeDir, "hooks.json"),
    leadInstructionsPath: path.join(codexHomeDir, LEAD_INSTRUCTIONS_FILE),
    agentsDir: path.join(codexHomeDir, "agents"),
    skillsDir: path.join(agentsRootDir, "skills"),
    marketplacePath: path.join(agentsRootDir, "plugins", "marketplace.json"),
    pluginInstallDir,
    pluginSourcePath: scope === "user" ? "./.codex/plugins/codex-nexus" : "./plugins/codex-nexus",
    projectGitignorePath: path.join(projectRoot, ".gitignore"),
    managedStateDir,
    managedStatePath: path.join(managedStateDir, INSTALL_STATE_FILENAME)
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

  const installedRoot = scopePaths.managedInstalledPackageRoot;
  if (!existsSync(installedRoot)) {
    throw new Error(`Installed package not found at ${installedRoot}`);
  }
  return installedRoot;
}

function quotePathForShell(filePath) {
  return `"${filePath.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"")}"`;
}

function buildManagedHookSpec(installedPackageRoot) {
  const hookScriptPath = path.join(installedPackageRoot, "scripts", "codex-nexus-hook.mjs");
  const quotedHookScriptPath = quotePathForShell(hookScriptPath);

  return {
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
        matcher: MANAGED_TOOL_HOOK_MATCHER,
        hooks: [
          {
            type: "command",
            command: `node ${quotedHookScriptPath} pre-tool-use`,
            timeout: 30
          }
        ]
      }
    ],
    PermissionRequest: [
      {
        matcher: MANAGED_TOOL_HOOK_MATCHER,
        hooks: [
          {
            type: "command",
            command: `node ${quotedHookScriptPath} permission-request`,
            timeout: 30
          }
        ]
      }
    ],
    Stop: [
      {
        hooks: [
          {
            type: "command",
            command: `node ${quotedHookScriptPath} stop`,
            timeout: 30
          }
        ]
      }
    ]
  };
}

function isManagedHookCommand(command) {
  return typeof command === "string" && /codex-nexus-hook/.test(command);
}

function hasManagedHooksRecord(hooksRecord) {
  for (const groups of Object.values(safeObject(hooksRecord))) {
    if (!Array.isArray(groups)) {
      continue;
    }

    for (const group of groups) {
      if (!group || typeof group !== "object" || !Array.isArray(group.hooks)) {
        continue;
      }
      if (group.hooks.some((hook) => hook?.type === "command" && isManagedHookCommand(hook.command))) {
        return true;
      }
    }
  }

  return false;
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

function mergeManagedHookRecord(existingHooksRecord, managedHooksRecord) {
  const next = {
    ...safeObject(existingHooksRecord)
  };

  for (const [eventName, groups] of Object.entries(managedHooksRecord)) {
    const existingGroups = Array.isArray(next[eventName]) ? next[eventName] : [];
    const preserved = existingGroups
      .map((group) => stripManagedHookGroup(group))
      .filter((group) => group !== null);
    next[eventName] = [...preserved, ...groups];
  }

  return next;
}

function stripManagedHooksRecord(existingHooksRecord) {
  const hooks = safeObject(existingHooksRecord);
  const nextHooks = {};

  for (const [eventName, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) {
      nextHooks[eventName] = groups;
      continue;
    }

    const cleanedGroups = groups
      .map((group) => stripManagedHookGroup(group))
      .filter((group) => group !== null);

    if (cleanedGroups.length > 0) {
      nextHooks[eventName] = cleanedGroups;
    }
  }

  return Object.keys(nextHooks).length > 0 ? nextHooks : null;
}

function setParsedHooksRecord(parsed, hooksRecord) {
  if (hooksRecord && Object.keys(hooksRecord).length > 0) {
    parsed.hooks = hooksRecord;
    return;
  }
  delete parsed.hooks;
}

function mergeHooksJson(existingContent, installedPackageRoot) {
  const parsed = existingContent ? JSON.parse(existingContent) : {};
  const next = {
    ...parsed
  };
  const managed = buildManagedHookSpec(installedPackageRoot);
  setParsedHooksRecord(next, mergeManagedHookRecord(parsed.hooks, managed));

  return JSON.stringify(next, null, 2) + "\n";
}

function stripManagedHooksJson(existingContent, fileExisted) {
  const parsed = existingContent ? JSON.parse(existingContent) : {};
  const next = {
    ...parsed
  };
  setParsedHooksRecord(next, stripManagedHooksRecord(parsed.hooks));

  if (Object.keys(next).length === 0 && !fileExisted) {
    return null;
  }

  return JSON.stringify(next, null, 2) + "\n";
}

function extractSemver(text) {
  if (typeof text !== "string") {
    return null;
  }

  const match = text.match(/\d+\.\d+\.\d+/);
  return match ? match[0] : null;
}

function compareSemver(left, right) {
  const leftParts = String(left).split(".").map((value) => Number.parseInt(value, 10));
  const rightParts = String(right).split(".").map((value) => Number.parseInt(value, 10));
  const maxLength = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < maxLength; index += 1) {
    const leftValue = Number.isFinite(leftParts[index]) ? leftParts[index] : 0;
    const rightValue = Number.isFinite(rightParts[index]) ? rightParts[index] : 0;

    if (leftValue > rightValue) {
      return 1;
    }
    if (leftValue < rightValue) {
      return -1;
    }
  }

  return 0;
}

async function detectCodexCliVersion(cwd, env) {
  try {
    const output = await runCommand("codex", ["--version"], cwd, env);
    return extractSemver(output);
  } catch {
    return null;
  }
}

async function supportsStableInlineHooks(scopePaths, runtime = {}) {
  if (typeof runtime.inlineHooksSupported === "boolean") {
    return runtime.inlineHooksSupported;
  }

  const codexVersion = typeof runtime.codexVersion === "string"
    ? runtime.codexVersion
    : await detectCodexCliVersion(runtime.cwd ?? scopePaths.projectRoot, runtime.env ?? process.env);

  return codexVersion
    ? compareSemver(codexVersion, STABLE_INLINE_HOOKS_MIN_CODEX_VERSION) >= 0
    : false;
}

async function resolveManagedHookSurface(scopePaths, runtime = {}) {
  const configContent = readTextIfExists(scopePaths.configTomlPath);
  const hooksContent = readTextIfExists(scopePaths.hooksJsonPath);
  const parsedConfig = configContent ? TOML.parse(configContent) : {};
  const inlineHooks = safeObject(parsedConfig.hooks);
  const jsonHooks = hooksContent ? safeObject(JSON.parse(hooksContent).hooks) : {};

  if (hasManagedHooksRecord(inlineHooks)) {
    return HOOK_SURFACE_INLINE;
  }
  if (hasManagedHooksRecord(jsonHooks)) {
    return HOOK_SURFACE_JSON;
  }
  if (Object.keys(inlineHooks).length > 0) {
    return HOOK_SURFACE_INLINE;
  }
  if (hooksContent !== null) {
    return HOOK_SURFACE_JSON;
  }

  return await supportsStableInlineHooks(scopePaths, runtime)
    ? HOOK_SURFACE_INLINE
    : HOOK_SURFACE_JSON;
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

function managedConfigPatch(runtimeCommand, serverPath) {
  return {
    modelInstructionsFile: LEAD_INSTRUCTIONS_FILE,
    features: {
      multi_agent: true,
      child_agents_md: true,
      codex_hooks: true
    },
    mcpServerNx: managedInstalledNxServerConfig(runtimeCommand, serverPath)
  };
}

function mergeConfigToml(existingContent, runtimeCommand, serverPath, managedHookSpec = null) {
  const parsed = existingContent ? TOML.parse(existingContent) : {};
  const features = safeObject(parsed.features);
  const mcpServers = safeObject(parsed.mcp_servers);
  const managed = managedConfigPatch(runtimeCommand, serverPath);

  parsed.model_instructions_file = managed.modelInstructionsFile;
  parsed.features = {
    ...features,
    ...managed.features
  };
  parsed.mcp_servers = {
    ...mcpServers,
    nx: managed.mcpServerNx
  };
  if (managedHookSpec) {
    setParsedHooksRecord(parsed, mergeManagedHookRecord(parsed.hooks, managedHookSpec));
  }

  return TOML.stringify(parsed);
}

function captureValueState(record, key) {
  return objectHas(record, key)
    ? { existed: true, value: record[key] }
    : { existed: false };
}

function restoreValueState(record, key, state) {
  if (state?.existed) {
    record[key] = state.value;
    return;
  }
  delete record[key];
}

function deleteIfEmptyObject(record, key) {
  if (record[key] && typeof record[key] === "object" && !Array.isArray(record[key]) && Object.keys(record[key]).length === 0) {
    delete record[key];
  }
}

function stringifyTomlOrNull(parsed, fileExisted) {
  if (Object.keys(parsed).length === 0 && !fileExisted) {
    return null;
  }
  return TOML.stringify(parsed);
}

function captureConfigState(filePath) {
  const content = readTextIfExists(filePath);
  const parsed = content ? TOML.parse(content) : {};
  const features = safeObject(parsed.features);
  const mcpServers = safeObject(parsed.mcp_servers);

  return {
    fileExisted: content !== null,
    modelInstructionsFile: captureValueState(parsed, "model_instructions_file"),
    features: Object.fromEntries(MANAGED_FEATURE_KEYS.map((key) => [key, captureValueState(features, key)])),
    mcpServerNx: captureValueState(mcpServers, "nx")
  };
}

function restoreConfigToml(existingContent, configState) {
  const parsed = existingContent ? TOML.parse(existingContent) : {};
  const features = {
    ...safeObject(parsed.features)
  };
  const mcpServers = {
    ...safeObject(parsed.mcp_servers)
  };

  restoreValueState(parsed, "model_instructions_file", configState.modelInstructionsFile);

  for (const key of MANAGED_FEATURE_KEYS) {
    restoreValueState(features, key, configState.features?.[key]);
  }
  if (Object.keys(features).length > 0) {
    parsed.features = features;
  } else {
    delete parsed.features;
  }

  restoreValueState(mcpServers, "nx", configState.mcpServerNx);
  if (Object.keys(mcpServers).length > 0) {
    parsed.mcp_servers = mcpServers;
  } else {
    delete parsed.mcp_servers;
  }

  deleteIfEmptyObject(parsed, "features");
  deleteIfEmptyObject(parsed, "mcp_servers");
  setParsedHooksRecord(parsed, stripManagedHooksRecord(parsed.hooks));

  return stringifyTomlOrNull(parsed, configState.fileExisted);
}

function looksManagedNxServerConfig(nxConfig) {
  const command = typeof nxConfig.command === "string" ? nxConfig.command : "";
  const args = Array.isArray(nxConfig.args) ? nxConfig.args : [];
  const serverPath = typeof args[0] === "string" ? args[0] : "";

  return command.length > 0 &&
    args.length === 1 &&
    serverPath.includes(path.join("@moreih29", "nexus-core")) &&
    serverPath.endsWith(NEXUS_CORE_SERVER_RELATIVE_PATH);
}

function removeExactManagedConfigToml(existingContent) {
  const parsed = existingContent ? TOML.parse(existingContent) : {};
  const features = {
    ...safeObject(parsed.features)
  };
  const mcpServers = {
    ...safeObject(parsed.mcp_servers)
  };

  if (parsed.model_instructions_file === LEAD_INSTRUCTIONS_FILE) {
    delete parsed.model_instructions_file;
  }

  for (const key of MANAGED_FEATURE_KEYS) {
    if (features[key] === true) {
      delete features[key];
    }
  }
  if (Object.keys(features).length > 0) {
    parsed.features = features;
  } else {
    delete parsed.features;
  }

  if (looksManagedNxServerConfig(mcpServers.nx ?? {})) {
    delete mcpServers.nx;
  }
  if (Object.keys(mcpServers).length > 0) {
    parsed.mcp_servers = mcpServers;
  } else {
    delete parsed.mcp_servers;
  }

  deleteIfEmptyObject(parsed, "features");
  deleteIfEmptyObject(parsed, "mcp_servers");
  setParsedHooksRecord(parsed, stripManagedHooksRecord(parsed.hooks));

  return stringifyTomlOrNull(parsed, false);
}

function marketplaceEntry(pluginSourcePath) {
  return {
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
}

function mergeMarketplaceJson(existingContent, pluginSourcePath) {
  const parsed = existingContent ? JSON.parse(existingContent) : {};
  const marketplace = {
    ...parsed,
    name: typeof parsed.name === "string" && parsed.name.trim().length > 0 ? parsed.name : DEFAULT_MARKETPLACE_NAME,
    interface: {
      ...safeObject(parsed.interface),
      displayName: safeObject(parsed.interface).displayName ?? DEFAULT_MARKETPLACE_DISPLAY_NAME
    },
    plugins: Array.isArray(parsed.plugins) ? parsed.plugins : []
  };

  const nextEntry = marketplaceEntry(pluginSourcePath);
  const existingIndex = marketplace.plugins.findIndex((entry) => entry?.name === PLUGIN_NAME);
  if (existingIndex === -1) {
    marketplace.plugins.push(nextEntry);
  } else {
    marketplace.plugins[existingIndex] = nextEntry;
  }

  return JSON.stringify(marketplace, null, 2) + "\n";
}

function captureMarketplaceState(filePath) {
  const content = readTextIfExists(filePath);
  const parsed = content ? JSON.parse(content) : {};
  const interfaceConfig = safeObject(parsed.interface);
  const plugins = Array.isArray(parsed.plugins) ? parsed.plugins : [];
  const currentEntry = plugins.find((entry) => entry?.name === PLUGIN_NAME) ?? null;

  return {
    fileExisted: content !== null,
    name: captureValueState(parsed, "name"),
    interfaceDisplayName: captureValueState(interfaceConfig, "displayName"),
    pluginEntry: currentEntry
  };
}

function cleanupMarketplaceTopLevel(parsed, marketplaceState) {
  restoreValueState(parsed, "name", marketplaceState.name);

  const interfaceConfig = {
    ...safeObject(parsed.interface)
  };
  restoreValueState(interfaceConfig, "displayName", marketplaceState.interfaceDisplayName);
  if (Object.keys(interfaceConfig).length > 0) {
    parsed.interface = interfaceConfig;
  } else {
    delete parsed.interface;
  }
}

function restoreMarketplaceJson(existingContent, marketplaceState) {
  const parsed = existingContent ? JSON.parse(existingContent) : {};
  const plugins = Array.isArray(parsed.plugins) ? [...parsed.plugins] : [];
  const filteredPlugins = plugins.filter((entry) => entry?.name !== PLUGIN_NAME);

  if (marketplaceState.pluginEntry) {
    filteredPlugins.push(marketplaceState.pluginEntry);
  }

  if (filteredPlugins.length > 0) {
    parsed.plugins = filteredPlugins;
  } else {
    delete parsed.plugins;
  }

  cleanupMarketplaceTopLevel(parsed, marketplaceState);

  if (Object.keys(parsed).length === 0 && !marketplaceState.fileExisted) {
    return null;
  }

  return JSON.stringify(parsed, null, 2) + "\n";
}

function removeExactManagedMarketplaceJson(existingContent) {
  const parsed = existingContent ? JSON.parse(existingContent) : {};
  const plugins = Array.isArray(parsed.plugins) ? parsed.plugins.filter((entry) => entry?.name !== PLUGIN_NAME) : [];

  if (plugins.length > 0) {
    parsed.plugins = plugins;
  } else {
    delete parsed.plugins;
  }

  if (parsed.name === DEFAULT_MARKETPLACE_NAME) {
    delete parsed.name;
  }

  const interfaceConfig = {
    ...safeObject(parsed.interface)
  };
  if (interfaceConfig.displayName === DEFAULT_MARKETPLACE_DISPLAY_NAME) {
    delete interfaceConfig.displayName;
  }
  if (Object.keys(interfaceConfig).length > 0) {
    parsed.interface = interfaceConfig;
  } else {
    delete parsed.interface;
  }

  if (Object.keys(parsed).length === 0) {
    return null;
  }

  return JSON.stringify(parsed, null, 2) + "\n";
}

function captureGitignoreState(filePath) {
  const existing = readTextIfExists(filePath);
  const lines = new Set((existing ?? "").split(/\r?\n/).filter(Boolean));

  return {
    fileExisted: existing !== null,
    addedLines: MANAGED_GITIGNORE_LINES.filter((line) => !lines.has(line))
  };
}

function ensureProjectGitignore(projectRoot) {
  const gitignorePath = path.join(projectRoot, ".gitignore");
  const existing = readTextIfExists(gitignorePath) ?? "";
  const lines = new Set(existing.split(/\r?\n/).filter(Boolean));
  let changed = false;

  for (const line of MANAGED_GITIGNORE_LINES) {
    if (!lines.has(line)) {
      lines.add(line);
      changed = true;
    }
  }

  if (changed || !existsSync(gitignorePath)) {
    writeText(gitignorePath, `${Array.from(lines).join("\n")}\n`);
  }
}

function restoreGitignore(existingContent, gitignoreState) {
  const lines = (existingContent ?? "").split(/\r?\n/);
  const kept = lines.filter((line) => !gitignoreState.addedLines.includes(line));
  const normalized = kept.filter((line, index, array) => !(line === "" && index === array.length - 1));
  const nonEmpty = normalized.filter((line) => line.length > 0);

  if (nonEmpty.length === 0 && !gitignoreState.fileExisted) {
    return null;
  }

  return nonEmpty.length > 0 ? `${nonEmpty.join("\n")}\n` : "";
}

function removeExactManagedGitignore(existingContent) {
  const lines = (existingContent ?? "").split(/\r?\n/);
  const kept = lines.filter((line) => !MANAGED_GITIGNORE_LINES.includes(line) && !(line === "" && line === lines.at(-1)));
  const nonEmpty = kept.filter((line) => line.length > 0);
  return nonEmpty.length > 0 ? `${nonEmpty.join("\n")}\n` : null;
}

function capturePathBackup(targetPath, managedStateDir, backupName) {
  if (!existsSync(targetPath)) {
    return {
      existed: false
    };
  }

  const backupPath = path.join(managedStateDir, "backup", backupName);
  removePath(backupPath);
  ensureDir(path.dirname(backupPath));
  cpSync(targetPath, backupPath, { recursive: true });

  return {
    existed: true,
    kind: statSync(targetPath).isDirectory() ? "directory" : "file",
    backupPath: path.relative(managedStateDir, backupPath)
  };
}

function restorePathBackup(targetPath, snapshot, managedStateDir) {
  removePath(targetPath);

  if (!snapshot?.existed || !snapshot.backupPath) {
    return;
  }

  const backupPath = path.join(managedStateDir, snapshot.backupPath);
  if (!existsSync(backupPath)) {
    return;
  }

  ensureDir(path.dirname(targetPath));
  cpSync(backupPath, targetPath, { recursive: true });
}

function cleanupEmptyAncestors(startPath, boundaryPath) {
  let current = path.resolve(startPath);
  const boundary = path.resolve(boundaryPath);

  while (current.startsWith(boundary) && current !== boundary) {
    if (!existsSync(current)) {
      current = path.dirname(current);
      continue;
    }

    const stats = statSync(current);
    if (!stats.isDirectory()) {
      return;
    }
    if (readdirSync(current).length > 0) {
      return;
    }

    rmSync(current, { recursive: true, force: true });
    current = path.dirname(current);
  }
}

function detectExistingManagedInstall(scopePaths) {
  const config = readTextIfExists(scopePaths.configTomlPath) ?? "";
  const hooks = readTextIfExists(scopePaths.hooksJsonPath) ?? "";
  const marketplace = readTextIfExists(scopePaths.marketplacePath) ?? "";
  const parsedConfig = config ? TOML.parse(config) : {};
  const pluginManifest = readJsonIfExists(path.join(scopePaths.pluginInstallDir, ".codex-plugin", "plugin.json"));

  return parsedConfig.model_instructions_file === LEAD_INSTRUCTIONS_FILE ||
    hasManagedHooksRecord(parsedConfig.hooks) ||
    hooks.includes("codex-nexus-hook") ||
    marketplace.includes(`"name": "${PLUGIN_NAME}"`) ||
    pluginManifest?.name === PLUGIN_NAME;
}

function createLegacyInstallState(scopePaths) {
  return {
    schemaVersion: INSTALL_STATE_VERSION,
    packageName: PACKAGE_NAME,
    scope: scopePaths.scope,
    createdAt: new Date().toISOString(),
    legacy: true
  };
}

function captureInstallState(scopePaths) {
  return {
    schemaVersion: INSTALL_STATE_VERSION,
    packageName: PACKAGE_NAME,
    scope: scopePaths.scope,
    createdAt: new Date().toISOString(),
    legacy: false,
    config: captureConfigState(scopePaths.configTomlPath),
    hooks: {
      fileExisted: readTextIfExists(scopePaths.hooksJsonPath) !== null
    },
    marketplace: captureMarketplaceState(scopePaths.marketplacePath),
    gitignore: scopePaths.scope === "project" ? captureGitignoreState(scopePaths.projectGitignorePath) : null,
    paths: {
      pluginInstallDir: capturePathBackup(scopePaths.pluginInstallDir, scopePaths.managedStateDir, "plugin-install-dir"),
      agentsDir: capturePathBackup(scopePaths.agentsDir, scopePaths.managedStateDir, "agents-dir"),
      skillsDir: capturePathBackup(scopePaths.skillsDir, scopePaths.managedStateDir, "skills-dir"),
      leadInstructions: capturePathBackup(scopePaths.leadInstructionsPath, scopePaths.managedStateDir, "lead-instructions")
    },
    packageStoreDirExisted: existsSync(scopePaths.packageStoreDir)
  };
}

function readManagedInstallState(scopePaths) {
  const parsed = readJsonIfExists(scopePaths.managedStatePath);
  if (!parsed || typeof parsed !== "object") {
    return null;
  }
  if (parsed.packageName !== PACKAGE_NAME) {
    return null;
  }
  if (parsed.scope !== scopePaths.scope) {
    return null;
  }
  return parsed;
}

function writeManagedInstallState(scopePaths, state) {
  writeJson(scopePaths.managedStatePath, state);
}

function ensureManagedInstallState(scopePaths) {
  const existingState = readManagedInstallState(scopePaths);
  if (existingState) {
    return existingState;
  }

  const state = detectExistingManagedInstall(scopePaths)
    ? createLegacyInstallState(scopePaths)
    : captureInstallState(scopePaths);

  writeManagedInstallState(scopePaths, state);
  return state;
}

function writeMaybeText(filePath, content) {
  if (content === null) {
    removePath(filePath);
    return;
  }
  writeText(filePath, content);
}

function removeManagedPackageStore(scopePaths, packageStoreDirExisted) {
  removePath(scopePaths.managedInstalledPackageRoot);
  if (!packageStoreDirExisted) {
    cleanupEmptyAncestors(path.join(scopePaths.packageStoreDir, "node_modules"), scopePaths.codexHomeDir);
  }
}

async function installManagedSurfaces(installedPackageRoot, scopePaths, runtime = {}) {
  const pluginSourceRoot = path.join(installedPackageRoot, "plugins", PLUGIN_NAME);
  const nexusCoreVersion = resolveNexusCoreVersion(installedPackageRoot);
  const runtimeCommand = resolveRuntimeCommand();
  const nexusCoreServerPath = resolveNexusCoreServerPath(installedPackageRoot);
  const hookSurface = await resolveManagedHookSurface(scopePaths, runtime);
  const managedHookSpec = buildManagedHookSpec(installedPackageRoot);

  copyDirectory(pluginSourceRoot, scopePaths.pluginInstallDir);
  copyDirectory(path.join(pluginSourceRoot, "agents"), scopePaths.agentsDir);
  rewriteManagedAgentNxServerConfigs(scopePaths.agentsDir, runtimeCommand, nexusCoreServerPath);
  copyDirectory(path.join(pluginSourceRoot, "skills"), scopePaths.skillsDir);
  writeText(
    scopePaths.leadInstructionsPath,
    readFileSync(path.join(pluginSourceRoot, LEAD_INSTRUCTIONS_FILE), "utf8")
  );
  writeText(
    scopePaths.configTomlPath,
    mergeConfigToml(
      readTextIfExists(scopePaths.configTomlPath),
      runtimeCommand,
      nexusCoreServerPath,
      hookSurface === HOOK_SURFACE_INLINE ? managedHookSpec : null
    )
  );
  if (hookSurface === HOOK_SURFACE_JSON) {
    writeText(
      scopePaths.hooksJsonPath,
      mergeHooksJson(readTextIfExists(scopePaths.hooksJsonPath), installedPackageRoot)
    );
  }
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
    nexusCoreServerPath,
    hookSurface
  };
}

async function installCommand(options = {}, runtime = {}) {
  const scope = normalizeScope(options.scope) ?? "user";
  const cwd = runtime.cwd ?? process.cwd();
  const env = runtime.env ?? process.env;
  const scopePaths = resolveScopePaths(scope, cwd, env);
  const requestedVersion = PACKAGE_VERSION;

  const managedState = ensureManagedInstallState(scopePaths);
  const installedPackageRoot = await resolveInstalledPackageRoot(scopePaths, requestedVersion, runtime);
  const installedVersion = await readInstalledPackageVersion(installedPackageRoot);
  const assets = await installManagedSurfaces(installedPackageRoot, scopePaths, runtime);
  if (!managedState.legacy) {
    writeManagedInstallState(scopePaths, {
      ...managedState,
      hooks: {
        ...safeObject(managedState.hooks),
        fileExisted: Boolean(managedState.hooks?.fileExisted),
        surface: assets.hookSurface
      }
    });
  }

  return {
    scope,
    requestedVersion,
    installedVersion,
    installedPackageRoot,
    projectRoot: scopePaths.projectRoot,
    codexHomeDir: scopePaths.codexHomeDir,
    packageStoreDir: scopePaths.packageStoreDir,
    pluginInstallDir: scopePaths.pluginInstallDir,
    configTomlPath: scopePaths.configTomlPath,
    hooksJsonPath: scopePaths.hooksJsonPath,
    marketplacePath: scopePaths.marketplacePath,
    leadInstructionsPath: scopePaths.leadInstructionsPath,
    agentsDir: scopePaths.agentsDir,
    skillsDir: scopePaths.skillsDir,
    managedStatePath: scopePaths.managedStatePath,
    uninstallMode: managedState.legacy ? "best-effort" : "restore",
    nexusCoreVersion: assets.nexusCoreVersion,
    runtimeCommand: assets.runtimeCommand,
    nexusCoreServerPath: assets.nexusCoreServerPath,
    hooksSurface: assets.hookSurface
  };
}

async function uninstallCommand(options = {}, runtime = {}) {
  const scope = normalizeScope(options.scope) ?? "user";
  const cwd = runtime.cwd ?? process.cwd();
  const env = runtime.env ?? process.env;
  const scopePaths = resolveScopePaths(scope, cwd, env);
  const managedState = readManagedInstallState(scopePaths);
  const useManagedRestore = Boolean(managedState && !managedState.legacy);

  if (useManagedRestore) {
    writeMaybeText(
      scopePaths.configTomlPath,
      restoreConfigToml(readTextIfExists(scopePaths.configTomlPath), managedState.config)
    );
    writeMaybeText(
      scopePaths.hooksJsonPath,
      stripManagedHooksJson(readTextIfExists(scopePaths.hooksJsonPath), managedState.hooks.fileExisted)
    );
    writeMaybeText(
      scopePaths.marketplacePath,
      restoreMarketplaceJson(readTextIfExists(scopePaths.marketplacePath), managedState.marketplace)
    );

    if (scopePaths.scope === "project" && managedState.gitignore) {
      writeMaybeText(
        scopePaths.projectGitignorePath,
        restoreGitignore(readTextIfExists(scopePaths.projectGitignorePath), managedState.gitignore)
      );
    }

    restorePathBackup(scopePaths.pluginInstallDir, managedState.paths?.pluginInstallDir, scopePaths.managedStateDir);
    restorePathBackup(scopePaths.agentsDir, managedState.paths?.agentsDir, scopePaths.managedStateDir);
    restorePathBackup(scopePaths.skillsDir, managedState.paths?.skillsDir, scopePaths.managedStateDir);
    restorePathBackup(scopePaths.leadInstructionsPath, managedState.paths?.leadInstructions, scopePaths.managedStateDir);
    removeManagedPackageStore(scopePaths, Boolean(managedState.packageStoreDirExisted));
    removePath(scopePaths.managedStateDir);

    return {
      scope,
      mode: "restore",
      managedStatePath: scopePaths.managedStatePath,
      pluginInstallDir: scopePaths.pluginInstallDir,
      configTomlPath: scopePaths.configTomlPath,
      hooksJsonPath: scopePaths.hooksJsonPath,
      marketplacePath: scopePaths.marketplacePath
    };
  }

  writeMaybeText(scopePaths.configTomlPath, removeExactManagedConfigToml(readTextIfExists(scopePaths.configTomlPath)));
  writeMaybeText(scopePaths.hooksJsonPath, stripManagedHooksJson(readTextIfExists(scopePaths.hooksJsonPath), false));
  writeMaybeText(scopePaths.marketplacePath, removeExactManagedMarketplaceJson(readTextIfExists(scopePaths.marketplacePath)));

  if (scopePaths.scope === "project") {
    writeMaybeText(scopePaths.projectGitignorePath, removeExactManagedGitignore(readTextIfExists(scopePaths.projectGitignorePath)));
  }

  removePath(scopePaths.pluginInstallDir);
  removePath(scopePaths.agentsDir);
  removePath(scopePaths.skillsDir);
  removePath(scopePaths.leadInstructionsPath);
  removeManagedPackageStore(scopePaths, true);
  removePath(scopePaths.managedStateDir);

  return {
    scope,
    mode: "best-effort",
    managedStatePath: scopePaths.managedStatePath,
    pluginInstallDir: scopePaths.pluginInstallDir,
    configTomlPath: scopePaths.configTomlPath,
    hooksJsonPath: scopePaths.hooksJsonPath,
    marketplacePath: scopePaths.marketplacePath
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
  const parsedHooks = hooks ? JSON.parse(hooks) : {};
  const nxConfig = safeObject(safeObject(parsedConfig.mcp_servers).nx);
  const nxCommand = typeof nxConfig.command === "string" ? nxConfig.command : "";
  const nxArgs = Array.isArray(nxConfig.args) ? nxConfig.args : [];
  const nxServerPath = typeof nxArgs[0] === "string" ? nxArgs[0] : "";
  const hasManagedInlineHooks = hasManagedHooksRecord(parsedConfig.hooks);
  const hasManagedHooksJson = hasManagedHooksRecord(parsedHooks.hooks);
  const hooksSurface = hasManagedInlineHooks && hasManagedHooksJson
    ? `${HOOK_SURFACE_INLINE} + ${HOOK_SURFACE_JSON}`
    : hasManagedInlineHooks
      ? HOOK_SURFACE_INLINE
      : hasManagedHooksJson
        ? HOOK_SURFACE_JSON
        : null;
  const packageStoreRoot = env[TEST_PACKAGE_ROOT_ENV]
    ? path.resolve(env[TEST_PACKAGE_ROOT_ENV])
    : paths.managedInstalledPackageRoot;
  const usesLocalDevelopmentHooks = [config, hooks].some((content) =>
    content.includes(path.join(PACKAGE_ROOT, "scripts", "codex-nexus-hook.mjs")) ||
    content.includes("node ./scripts/codex-nexus-hook.mjs")
  );
  const installedAgentNxConfigs = readAgentNxServerConfigs(paths.agentsDir);
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
        config.includes(`model_instructions_file = "${LEAD_INSTRUCTIONS_FILE}"`) &&
        config.includes("[mcp_servers.nx]") &&
        nxCommand.length > 0 &&
        existsSync(nxCommand) &&
        nxServerPath.length > 0 &&
        existsSync(nxServerPath)
    },
    { label: hooksSurface ? `hooks surface (${hooksSurface})` : "hooks surface", ok: hooksSurface !== null },
    { label: "marketplace.json", ok: existsSync(paths.marketplacePath) && marketplace.includes(paths.pluginSourcePath) },
    { label: ".codex/agents/lead.toml", ok: existsSync(path.join(paths.agentsDir, "lead.toml")) },
    { label: ".codex/agents use resolved nx MCP launcher", ok: usesResolvedNxLauncher(installedAgentNxConfigs) },
    { label: ".agents/skills/nx-plan", ok: existsSync(path.join(paths.skillsDir, "nx-plan", "SKILL.md")) },
    { label: "package store", ok: usesLocalDevelopmentHooks || existsSync(path.join(packageStoreRoot, "package.json")) }
  ];

  return {
    scope,
    hooksSurface,
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
    `hooks surface: ${result.hooksSurface}`,
    `uninstall mode: ${result.uninstallMode}`,
    `state: ${result.managedStatePath}`,
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

function formatUninstallSummary(result) {
  return [
    "codex-nexus uninstall complete",
    `scope: ${result.scope}`,
    `mode: ${result.mode}`,
    `state: ${result.managedStatePath}`,
    `plugin: ${result.pluginInstallDir}`,
    `config: ${result.configTomlPath}`,
    `hooks: ${result.hooksJsonPath}`,
    `marketplace: ${result.marketplacePath}`
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
      command: "help",
      options: { help: true }
    };
  }

  if (command === "--version" || command === "-V" || command === "version") {
    if (rest.length > 0) {
      throw new Error(`Unknown option "${rest[0]}".`);
    }
    return {
      command: "version",
      options: {}
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
      : command === "uninstall"
        ? "Which installation scope do you want to remove?"
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

function validateScopedOptions(options) {
  if (options.scope && !normalizeScope(options.scope)) {
    throw new Error(`Invalid --scope value "${options.scope}". Expected "user" or "project".`);
  }
}

async function resolveInstallOptions(parsed) {
  const interactive = isInteractiveTerminal();
  const options = { ...parsed.options };

  validateScopedOptions(options);

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

  validateScopedOptions(options);

  if (!options.scope && interactive) {
    options.scope = await promptScope("doctor");
  } else if (!options.scope) {
    options.scope = "user";
  }

  return options;
}

async function resolveUninstallOptions(parsed) {
  const interactive = isInteractiveTerminal();
  const options = { ...parsed.options };

  validateScopedOptions(options);

  if (!options.scope && interactive) {
    options.scope = await promptScope("uninstall");
  } else if (!options.scope) {
    options.scope = "user";
  }

  return options;
}

function printHelp() {
  process.stdout.write(`codex-nexus

Usage:
  codex-nexus install [--scope user|project]
  codex-nexus uninstall [--scope user|project]
  codex-nexus doctor [--scope user|project]
  codex-nexus version
  codex-nexus --version
`);
}

function printVersion() {
  process.stdout.write(`${PACKAGE_VERSION}\n`);
}

async function runCli(argv = process.argv, runtime = {}) {
  const parsed = parseArgs(argv);

  if (parsed.options.help || parsed.command === "help") {
    printHelp();
    return 0;
  }

  if (parsed.command === "version") {
    printVersion();
    return 0;
  }

  if (parsed.command === "doctor") {
    const options = await resolveDoctorOptions(parsed, runtime);
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

  if (parsed.command === "uninstall") {
    const interactive = isInteractiveTerminal();
    if (interactive) {
      intro("codex-nexus uninstall");
    }

    const options = await resolveUninstallOptions(parsed, runtime);
    const s = interactive ? spinner() : null;

    try {
      if (s) {
        s.start("Uninstalling codex-nexus");
      }
      const result = await uninstallCommand(options, runtime);
      if (s) {
        s.stop("Uninstall complete");
        outro(formatUninstallSummary(result));
      } else {
        process.stdout.write(formatUninstallSummary(result) + "\n");
      }
      return 0;
    } catch (error) {
      if (s) {
        s.stop("Uninstall failed");
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
  PACKAGE_VERSION,
  doctorCommand,
  formatDoctorSummary,
  formatInstallSummary,
  formatUninstallSummary,
  installCommand,
  mergeConfigToml,
  mergeHooksJson,
  mergeMarketplaceJson,
  resolveInstalledPackageRoot,
  resolveNexusCorePackageRoot,
  resolveNexusCoreServerPath,
  resolveNexusCoreVersion,
  resolveScopePaths,
  runCli,
  uninstallCommand
};
