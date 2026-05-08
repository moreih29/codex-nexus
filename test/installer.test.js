import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import TOML from "@iarna/toml";
import {
  doctorCommand,
  formatInstallSummary,
  installCommand,
  listManagedHookTrustEntries,
  resolveNexusCorePackageRoot,
  resolveScopePaths,
  runCli,
  trustManagedHooks,
  uninstallCommand
} from "../scripts/codex-nexus.mjs";

const packageRoot = path.resolve(path.join(import.meta.dir, ".."));
const cliPath = path.join(packageRoot, "scripts", "codex-nexus.mjs");
const pkg = JSON.parse(readFileSync(path.join(packageRoot, "package.json"), "utf8"));
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

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeToml(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, TOML.stringify(value), "utf8");
}

function readAgentTomlFiles(agentDir) {
  return readdirSync(agentDir)
    .filter((entry) => entry.endsWith(".toml"))
    .sort();
}

function readAgentNxConfigs(agentDir) {
  return expectedSubagentFiles
    .map((entry) => {
      const parsed = TOML.parse(readFileSync(path.join(agentDir, entry), "utf8"));
      return {
        file: entry,
        model: parsed.model,
        nx: parsed?.mcp_servers?.nx ?? {}
      };
    });
}

function testEnv(extra = {}) {
  return {
    ...process.env,
    CODEX_NEXUS_TEST_PACKAGE_ROOT: packageRoot,
    ...extra
  };
}

test("version command and flags print the package version", () => {
  for (const args of [["version"], ["--version"], ["-V"]]) {
    const output = execFileSync(process.execPath, [cliPath, ...args], {
      cwd: packageRoot,
      encoding: "utf8"
    });
    expect(output.trim()).toBe(pkg.version);
  }
});

test("project install wires plugin, config, hooks, agents, and skills", async () => {
  const repoRoot = mkdtempSync(path.join(tmpdir(), "codex-nexus-project-"));
  mkdirSync(path.join(repoRoot, ".git"));
  writeFileSync(path.join(repoRoot, "package.json"), "{}\n", "utf8");

  try {
    const env = testEnv();
    const result = await installCommand({ scope: "project" }, { cwd: repoRoot, env, inlineHooksSupported: false });

    expect(result.scope).toBe("project");
    expect(result.hooksSurface).toBe("config.toml");
    expect(existsSync(path.join(repoRoot, "plugins", "codex-nexus", ".codex-plugin", "plugin.json"))).toBe(true);
    expect(existsSync(path.join(repoRoot, ".codex", "lead.instructions.md"))).toBe(true);
    expect(existsSync(path.join(repoRoot, ".codex", "agents", "lead.toml"))).toBe(true);
    expect(existsSync(path.join(repoRoot, ".agents", "skills", "nx-plan", "SKILL.md"))).toBe(true);
    expect(existsSync(result.managedStatePath)).toBe(true);
    const configContent = readFileSync(path.join(repoRoot, ".codex", "config.toml"), "utf8");
    const config = TOML.parse(configContent);
    expect(configContent).toContain('model_instructions_file = "lead.instructions.md"');
    expect(config.features.multi_agent).toBe(true);
    expect(config.features.hooks).toBe(true);
    expect(config.features.codex_hooks).toBeUndefined();
    expect(configContent).not.toContain('command = "npx"');
    expect(configContent).toContain("dist/mcp/server.js");
    expect(config.hooks.SessionStart[0].hooks[0].command).toContain(path.resolve(path.join(packageRoot, "scripts", "codex-nexus-hook.mjs")));
    expect(config.hooks.PermissionRequest[0].hooks[0].command).toContain("permission-request");
    expect(config.hooks.Stop[0].hooks[0].command).toContain("stop");
    expect(config.hooks.PreToolUse[0].matcher).toContain("apply_patch");
    expect(config.hooks.PreToolUse[0].matcher).toContain("mcp__");
    expect(existsSync(path.join(repoRoot, ".codex", "hooks.json"))).toBe(false);
    expect(readFileSync(path.join(repoRoot, ".gitignore"), "utf8")).toContain(".codex/");
    expect(readFileSync(path.join(repoRoot, ".gitignore"), "utf8")).toContain(".agents/");
    expect(readAgentTomlFiles(path.join(repoRoot, ".codex", "agents"))).toEqual(expectedAgentFiles);
    expect(readAgentTomlFiles(path.join(repoRoot, "plugins", "codex-nexus", "agents"))).toEqual(expectedAgentFiles);
    const installedAgentNxConfigs = readAgentNxConfigs(path.join(repoRoot, ".codex", "agents"));
    expect(installedAgentNxConfigs).toHaveLength(expectedSubagentFiles.length);
    for (const agent of installedAgentNxConfigs) {
      expect(agent.model).toBeUndefined();
      expect(agent.nx.command).toBe(result.runtimeCommand);
      expect(agent.nx.args).toEqual([result.nexusCoreServerPath]);
      expect(Array.isArray(agent.nx.disabled_tools)).toBe(true);
    }
    const installedPluginAgentNxConfigs = readAgentNxConfigs(path.join(repoRoot, "plugins", "codex-nexus", "agents"));
    expect(installedPluginAgentNxConfigs).toHaveLength(expectedSubagentFiles.length);
    for (const agent of installedPluginAgentNxConfigs) {
      expect(agent.model).toBeUndefined();
      expect(agent.nx.command).toBe("nexus-mcp");
      expect(agent.nx.args).toBeUndefined();
      expect(Array.isArray(agent.nx.disabled_tools)).toBe(true);
    }

    const marketplace = readJson(path.join(repoRoot, ".agents", "plugins", "marketplace.json"));
    expect(marketplace.plugins[0].source.path).toBe("./plugins/codex-nexus");
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("user install targets home-scoped marketplace and codex directories", async () => {
  const homeDir = mkdtempSync(path.join(tmpdir(), "codex-nexus-home-"));
  const workDir = mkdtempSync(path.join(tmpdir(), "codex-nexus-work-"));

  try {
    const env = testEnv({ HOME: homeDir });
    const result = await installCommand({ scope: "user", trustHooks: true }, { cwd: workDir, env, inlineHooksSupported: false });

    expect(result.scope).toBe("user");
    expect(result.hooksSurface).toBe("config.toml");
    expect(result.hookTrust.trusted).toBe(5);
    expect(existsSync(path.join(homeDir, ".codex", "plugins", "codex-nexus", ".codex-plugin", "plugin.json"))).toBe(true);
    expect(existsSync(path.join(homeDir, ".codex", "agents", "lead.toml"))).toBe(true);
    expect(existsSync(path.join(homeDir, ".agents", "skills", "nx-run", "SKILL.md"))).toBe(true);
    const config = TOML.parse(readFileSync(path.join(homeDir, ".codex", "config.toml"), "utf8"));
    expect(config.features.hooks).toBe(true);
    expect(config.features.codex_hooks).toBeUndefined();
    expect(JSON.stringify(config.hooks.state)).toContain("trusted_hash");
    expect(readFileSync(path.join(homeDir, ".codex", "config.toml"), "utf8")).not.toContain('command = "npx"');
    expect(readFileSync(path.join(homeDir, ".codex", "config.toml"), "utf8")).toContain("dist/mcp/server.js");
    expect(readAgentTomlFiles(path.join(homeDir, ".codex", "agents"))).toEqual(expectedAgentFiles);
    expect(readAgentTomlFiles(path.join(homeDir, ".codex", "plugins", "codex-nexus", "agents"))).toEqual(expectedAgentFiles);
    const installedAgentNxConfigs = readAgentNxConfigs(path.join(homeDir, ".codex", "agents"));
    expect(installedAgentNxConfigs).toHaveLength(expectedSubagentFiles.length);
    for (const agent of installedAgentNxConfigs) {
      expect(agent.model).toBeUndefined();
      expect(agent.nx.command).toBe(result.runtimeCommand);
      expect(agent.nx.args).toEqual([result.nexusCoreServerPath]);
      expect(Array.isArray(agent.nx.disabled_tools)).toBe(true);
    }
    const installedPluginAgentNxConfigs = readAgentNxConfigs(path.join(homeDir, ".codex", "plugins", "codex-nexus", "agents"));
    expect(installedPluginAgentNxConfigs).toHaveLength(expectedSubagentFiles.length);
    for (const agent of installedPluginAgentNxConfigs) {
      expect(agent.model).toBeUndefined();
      expect(agent.nx.command).toBe("nexus-mcp");
      expect(agent.nx.args).toBeUndefined();
      expect(Array.isArray(agent.nx.disabled_tools)).toBe(true);
    }

    const marketplace = readJson(path.join(homeDir, ".agents", "plugins", "marketplace.json"));
    expect(marketplace.plugins[0].source.path).toBe("./.codex/plugins/codex-nexus");

    const doctor = doctorCommand({ scope: "user" }, { cwd: workDir, env });
    expect(doctor.failed).toBe(0);
  } finally {
    rmSync(homeDir, { recursive: true, force: true });
    rmSync(workDir, { recursive: true, force: true });
  }
});

test("interactive install can hand off to model configuration when accepted", async () => {
  const repoRoot = mkdtempSync(path.join(tmpdir(), "codex-nexus-install-models-"));
  mkdirSync(path.join(repoRoot, ".git"));

  const originalForceTty = process.env.CODEX_NEXUS_FORCE_TTY;
  process.env.CODEX_NEXUS_FORCE_TTY = "1";

  try {
    let modelOptions = null;
    const result = await runCli(["node", "codex-nexus", "install", "--scope", "project"], {
      cwd: repoRoot,
      env: testEnv(),
      inlineHooksSupported: false,
      trustHooksAfterInstall: false,
      configureModelsAfterInstall: true,
      modelsAfterInstallCommand: async (options) => {
        modelOptions = options;
        return {
          scope: options.scope,
          configTomlPath: path.join(repoRoot, ".codex", "config.toml"),
          agentsDir: path.join(repoRoot, ".codex", "agents"),
          modelOverridesPath: path.join(repoRoot, ".codex", ".codex-nexus", "model-overrides.json"),
          cancelled: false,
          changed: [],
          applied: []
        };
      }
    });

    expect(result).toBe(0);
    expect(modelOptions).toEqual({ scope: "project", interactive: true });
  } finally {
    if (originalForceTty === undefined) {
      delete process.env.CODEX_NEXUS_FORCE_TTY;
    } else {
      process.env.CODEX_NEXUS_FORCE_TTY = originalForceTty;
    }
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("interactive install skips model configuration when declined", async () => {
  const repoRoot = mkdtempSync(path.join(tmpdir(), "codex-nexus-install-skip-models-"));
  mkdirSync(path.join(repoRoot, ".git"));

  const originalForceTty = process.env.CODEX_NEXUS_FORCE_TTY;
  process.env.CODEX_NEXUS_FORCE_TTY = "1";

  try {
    let called = false;
    const result = await runCli(["node", "codex-nexus", "install", "--scope", "project"], {
      cwd: repoRoot,
      env: testEnv(),
      inlineHooksSupported: false,
      trustHooksAfterInstall: false,
      configureModelsAfterInstall: false,
      modelsAfterInstallCommand: async () => {
        called = true;
      }
    });

    expect(result).toBe(0);
    expect(called).toBe(false);
  } finally {
    if (originalForceTty === undefined) {
      delete process.env.CODEX_NEXUS_FORCE_TTY;
    } else {
      process.env.CODEX_NEXUS_FORCE_TTY = originalForceTty;
    }
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("noninteractive install does not prompt for model configuration", async () => {
  const repoRoot = mkdtempSync(path.join(tmpdir(), "codex-nexus-install-noninteractive-models-"));
  mkdirSync(path.join(repoRoot, ".git"));

  try {
    let called = false;
    const result = await runCli(["node", "codex-nexus", "install", "--scope", "project"], {
      cwd: repoRoot,
      env: testEnv(),
      inlineHooksSupported: false,
      configureModelsAfterInstall: true,
      modelsAfterInstallCommand: async () => {
        called = true;
      }
    });

    expect(result).toBe(0);
    expect(called).toBe(false);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("project install prefers inline config hooks when stable inline hooks are supported", async () => {
  const homeDir = mkdtempSync(path.join(tmpdir(), "codex-nexus-project-inline-home-"));
  const repoRoot = mkdtempSync(path.join(tmpdir(), "codex-nexus-project-inline-"));
  mkdirSync(path.join(repoRoot, ".git"));
  writeFileSync(path.join(repoRoot, "package.json"), "{}\n", "utf8");

  try {
    const env = testEnv({ HOME: homeDir });
    const result = await installCommand({ scope: "project", trustHooks: true }, { cwd: repoRoot, env, inlineHooksSupported: true });

    expect(result.hooksSurface).toBe("config.toml");
    expect(result.hookTrust.trusted).toBe(5);
    expect(existsSync(path.join(repoRoot, ".codex", "hooks.json"))).toBe(false);

    const config = TOML.parse(readFileSync(path.join(repoRoot, ".codex", "config.toml"), "utf8"));
    expect(config.features.hooks).toBe(true);
    expect(config.features.codex_hooks).toBeUndefined();
    expect(config.hooks.state).toBeUndefined();
    expect(Array.isArray(config.hooks.SessionStart)).toBe(true);
    expect(config.hooks.SessionStart[0].hooks[0].command).toContain(path.resolve(path.join(packageRoot, "scripts", "codex-nexus-hook.mjs")));
    expect(config.hooks.PreToolUse[0].matcher).toContain("apply_patch");
    expect(config.hooks.PreToolUse[0].matcher).toContain("mcp__");
    expect(config.hooks.PermissionRequest[0].hooks[0].command).toContain("permission-request");
    expect(config.hooks.Stop[0].hooks[0].command).toContain("stop");

    const doctor = doctorCommand({ scope: "project" }, { cwd: repoRoot, env });
    expect(doctor.hooksSurface).toBe("config.toml");
    expect(doctor.failed).toBe(0);
  } finally {
    rmSync(homeDir, { recursive: true, force: true });
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("default install does not write hook trust state", async () => {
  const homeDir = mkdtempSync(path.join(tmpdir(), "codex-nexus-trust-home-"));
  const repoRoot = mkdtempSync(path.join(tmpdir(), "codex-nexus-trust-project-"));
  mkdirSync(path.join(repoRoot, ".git"));

  try {
    const env = testEnv({ HOME: homeDir });
    await installCommand({ scope: "project" }, { cwd: repoRoot, env, inlineHooksSupported: true });

    const projectConfig = TOML.parse(readFileSync(path.join(repoRoot, ".codex", "config.toml"), "utf8"));
    expect(projectConfig.hooks.state).toBeUndefined();
    expect(existsSync(path.join(homeDir, ".codex", "config.toml"))).toBe(false);
  } finally {
    rmSync(homeDir, { recursive: true, force: true });
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("project install with explicit trust writes user-level hook state and reports the target", async () => {
  const homeDir = mkdtempSync(path.join(tmpdir(), "codex-nexus-trust-explicit-home-"));
  const repoRoot = mkdtempSync(path.join(tmpdir(), "codex-nexus-trust-explicit-project-"));
  mkdirSync(path.join(repoRoot, ".git"));

  try {
    const env = testEnv({ HOME: homeDir });
    const result = await installCommand({ scope: "project", trustHooks: true }, { cwd: repoRoot, env, inlineHooksSupported: true });

    expect(result.hookTrust.trusted).toBe(5);
    expect(result.hookTrust.userConfigTomlPath).toBe(path.join(homeDir, ".codex", "config.toml"));
    expect(result.hookTrust.projectScopeUserConfig).toBe(true);

    const projectConfig = TOML.parse(readFileSync(path.join(repoRoot, ".codex", "config.toml"), "utf8"));
    expect(projectConfig.hooks.state).toBeUndefined();

    const userConfig = TOML.parse(readFileSync(path.join(homeDir, ".codex", "config.toml"), "utf8"));
    expect(Object.keys(userConfig.hooks.state)).toHaveLength(5);
    expect(formatInstallSummary(result)).toContain("current user Codex config");
  } finally {
    rmSync(homeDir, { recursive: true, force: true });
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("noninteractive CLI --trust-hooks writes hook trust state", async () => {
  const homeDir = mkdtempSync(path.join(tmpdir(), "codex-nexus-cli-trust-home-"));
  const repoRoot = mkdtempSync(path.join(tmpdir(), "codex-nexus-cli-trust-project-"));
  mkdirSync(path.join(repoRoot, ".git"));

  try {
    const env = testEnv({ HOME: homeDir });
    const result = await runCli(["node", "codex-nexus", "install", "--scope", "project", "--trust-hooks"], {
      cwd: repoRoot,
      env,
      inlineHooksSupported: true
    });

    expect(result).toBe(0);
    const projectConfig = TOML.parse(readFileSync(path.join(repoRoot, ".codex", "config.toml"), "utf8"));
    expect(projectConfig.hooks.state).toBeUndefined();
    const userConfig = TOML.parse(readFileSync(path.join(homeDir, ".codex", "config.toml"), "utf8"));
    expect(Object.keys(userConfig.hooks.state)).toHaveLength(5);
  } finally {
    rmSync(homeDir, { recursive: true, force: true });
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("interactive install can trust installed hooks when accepted", async () => {
  const homeDir = mkdtempSync(path.join(tmpdir(), "codex-nexus-trust-interactive-home-"));
  const repoRoot = mkdtempSync(path.join(tmpdir(), "codex-nexus-trust-interactive-project-"));
  mkdirSync(path.join(repoRoot, ".git"));

  const originalForceTty = process.env.CODEX_NEXUS_FORCE_TTY;
  process.env.CODEX_NEXUS_FORCE_TTY = "1";

  try {
    const env = testEnv({ HOME: homeDir });
    const result = await runCli(["node", "codex-nexus", "install", "--scope", "project"], {
      cwd: repoRoot,
      env,
      inlineHooksSupported: true,
      trustHooksAfterInstall: true,
      configureModelsAfterInstall: false
    });

    expect(result).toBe(0);
    const userConfig = TOML.parse(readFileSync(path.join(homeDir, ".codex", "config.toml"), "utf8"));
    expect(Object.keys(userConfig.hooks.state)).toHaveLength(5);
  } finally {
    if (originalForceTty === undefined) {
      delete process.env.CODEX_NEXUS_FORCE_TTY;
    } else {
      process.env.CODEX_NEXUS_FORCE_TTY = originalForceTty;
    }
    rmSync(homeDir, { recursive: true, force: true });
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("doctor distinguishes hook trust, disabled, modified, missing, and duplicate states", async () => {
  const homeDir = mkdtempSync(path.join(tmpdir(), "codex-nexus-doctor-hooks-home-"));
  const repoRoot = mkdtempSync(path.join(tmpdir(), "codex-nexus-doctor-hooks-"));
  mkdirSync(path.join(repoRoot, ".git"));

  try {
    const env = testEnv({ HOME: homeDir });
    await installCommand({ scope: "project" }, { cwd: repoRoot, env, inlineHooksSupported: true });

    const untrustedDoctor = doctorCommand({ scope: "project" }, { cwd: repoRoot, env });
    expect(untrustedDoctor.failedLabels).toContain("hook trust (5 untrusted)");

    const scopePaths = resolveScopePaths("project", repoRoot, env);
    trustManagedHooks(scopePaths, { cwd: repoRoot, env });
    const trustedDoctor = doctorCommand({ scope: "project" }, { cwd: repoRoot, env });
    expect(trustedDoctor.failed).toBe(0);

    const configPath = path.join(repoRoot, ".codex", "config.toml");
    const entries = listManagedHookTrustEntries(scopePaths, { cwd: repoRoot, env });
    const userConfigPath = resolveScopePaths("user", repoRoot, env).configTomlPath;
    const userConfig = TOML.parse(readFileSync(userConfigPath, "utf8"));
    userConfig.hooks.state[entries[0].key].enabled = false;
    writeToml(userConfigPath, userConfig);
    const disabledDoctor = doctorCommand({ scope: "project" }, { cwd: repoRoot, env });
    expect(disabledDoctor.failedLabels).toContain("hook enabled state (1 disabled)");

    userConfig.hooks.state[entries[0].key].enabled = true;
    writeToml(userConfigPath, userConfig);
    const modifiedConfig = TOML.parse(readFileSync(configPath, "utf8"));
    modifiedConfig.hooks.PreToolUse[0].hooks[0].timeout = 31;
    writeToml(configPath, modifiedConfig);
    const modifiedDoctor = doctorCommand({ scope: "project" }, { cwd: repoRoot, env });
    expect(modifiedDoctor.failedLabels).toContain("hook trust (1 modified)");

    modifiedConfig.hooks.PreToolUse[0].hooks[0].timeout = 30;
    modifiedConfig.features.plugin_hooks = true;
    writeToml(configPath, modifiedConfig);
    trustManagedHooks(scopePaths, { cwd: repoRoot, env });
    const duplicateDoctor = doctorCommand({ scope: "project" }, { cwd: repoRoot, env });
    expect(duplicateDoctor.failedLabels).toContain("native/direct hook duplicate");

    delete modifiedConfig.features.plugin_hooks;
    delete modifiedConfig.hooks;
    writeToml(configPath, modifiedConfig);
    const missingDoctor = doctorCommand({ scope: "project" }, { cwd: repoRoot, env });
    expect(missingDoctor.failedLabels).toContain("hooks surface");
  } finally {
    rmSync(homeDir, { recursive: true, force: true });
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("canonical hooks feature migrates managed codex_hooks and preserves user-owned codex_hooks", async () => {
  const managedRepoRoot = mkdtempSync(path.join(tmpdir(), "codex-nexus-managed-codex-hooks-"));
  const userRepoRoot = mkdtempSync(path.join(tmpdir(), "codex-nexus-user-codex-hooks-"));
  mkdirSync(path.join(managedRepoRoot, ".git"));
  mkdirSync(path.join(userRepoRoot, ".git"));

  try {
    const env = testEnv();
    writeToml(path.join(managedRepoRoot, ".codex", "config.toml"), {
      features: {
        codex_hooks: true
      }
    });
    writeJson(path.join(managedRepoRoot, ".codex", ".codex-nexus", "install-state.json"), {
      schemaVersion: 1,
      packageName: "codex-nexus",
      scope: "project",
      legacy: false,
      config: {
        fileExisted: true,
        modelInstructionsFile: { existed: false },
        features: {
          multi_agent: { existed: false },
          child_agents_md: { existed: false },
          hooks: { existed: false },
          codex_hooks: { existed: false }
        },
        mcpServerNx: { existed: false }
      },
      hooks: {
        fileExisted: false
      },
      marketplace: {
        fileExisted: false,
        name: { existed: false },
        interfaceDisplayName: { existed: false },
        pluginEntry: null
      },
      paths: {},
      packageStoreDirExisted: false
    });

    await installCommand({ scope: "project" }, { cwd: managedRepoRoot, env, inlineHooksSupported: true });
    const migratedConfig = TOML.parse(readFileSync(path.join(managedRepoRoot, ".codex", "config.toml"), "utf8"));
    expect(migratedConfig.features.hooks).toBe(true);
    expect(migratedConfig.features.codex_hooks).toBeUndefined();

    writeToml(path.join(userRepoRoot, ".codex", "config.toml"), {
      features: {
        codex_hooks: true,
        experimental: true
      }
    });
    const installResult = await installCommand({ scope: "project" }, { cwd: userRepoRoot, env, inlineHooksSupported: true });
    const installedConfig = TOML.parse(readFileSync(path.join(userRepoRoot, ".codex", "config.toml"), "utf8"));
    expect(installedConfig.features.hooks).toBe(true);
    expect(installedConfig.features.codex_hooks).toBe(true);

    await uninstallCommand({ scope: "project" }, { cwd: userRepoRoot, env });
    const restoredConfig = TOML.parse(readFileSync(path.join(userRepoRoot, ".codex", "config.toml"), "utf8"));
    expect(restoredConfig.features.experimental).toBe(true);
    expect(restoredConfig.features.codex_hooks).toBe(true);
    expect(restoredConfig.features.hooks).toBeUndefined();
    expect(existsSync(installResult.managedStatePath)).toBe(false);
  } finally {
    rmSync(managedRepoRoot, { recursive: true, force: true });
    rmSync(userRepoRoot, { recursive: true, force: true });
  }
});

test("managed hook trust primitives classify and write user-level state", async () => {
  const homeDir = mkdtempSync(path.join(tmpdir(), "codex-nexus-trust-home-"));
  const repoRoot = mkdtempSync(path.join(tmpdir(), "codex-nexus-trust-project-"));
  mkdirSync(path.join(repoRoot, ".git"));

  const projectConfigPath = path.join(repoRoot, ".codex", "config.toml");
  const userConfigPath = path.join(homeDir, ".codex", "config.toml");
  const unrelatedStateKey = "other-hooks.json:pre_tool_use:0:0";

  try {
    writeToml(projectConfigPath, {
      hooks: {
        SessionStart: [
          {
            hooks: [
              {
                type: "command",
                command: "echo keep-project-hook"
              }
            ]
          }
        ]
      }
    });
    writeToml(userConfigPath, {
      hooks: {
        state: {
          [unrelatedStateKey]: {
            enabled: false,
            trusted_hash: "sha256:keep"
          }
        }
      }
    });

    const env = testEnv({ HOME: homeDir });
    await installCommand({ scope: "project" }, { cwd: repoRoot, env, inlineHooksSupported: true });
    const scopePaths = resolveScopePaths("project", repoRoot, env);

    const untrustedEntries = listManagedHookTrustEntries(scopePaths, { cwd: repoRoot, env });
    expect(untrustedEntries).toHaveLength(5);
    expect(new Set(untrustedEntries.map((entry) => entry.status))).toEqual(new Set(["untrusted"]));
    expect(untrustedEntries.every((entry) => entry.command.includes("codex-nexus-hook"))).toBe(true);

    const trustResult = trustManagedHooks(scopePaths, { cwd: repoRoot, env });
    expect(trustResult.userConfigTomlPath).toBe(userConfigPath);
    expect(trustResult.entries).toHaveLength(untrustedEntries.length);

    const projectConfigAfterTrust = TOML.parse(readFileSync(projectConfigPath, "utf8"));
    expect(projectConfigAfterTrust.hooks.state).toBeUndefined();

    const userConfigAfterTrust = TOML.parse(readFileSync(userConfigPath, "utf8"));
    expect(userConfigAfterTrust.hooks.state[unrelatedStateKey]).toEqual({
      enabled: false,
      trusted_hash: "sha256:keep"
    });
    expect(userConfigAfterTrust.hooks.state[`${path.resolve(projectConfigPath)}:session_start:0:0`]).toBeUndefined();
    for (const entry of untrustedEntries) {
      expect(userConfigAfterTrust.hooks.state[entry.key].trusted_hash).toBe(entry.currentHash);
    }

    const trustedEntries = listManagedHookTrustEntries(scopePaths, { cwd: repoRoot, env });
    expect(new Set(trustedEntries.map((entry) => entry.status))).toEqual(new Set(["trusted"]));

    const disabledEntry = trustedEntries.find((entry) => entry.eventName === "SessionStart");
    const modifiedEntry = trustedEntries.find((entry) => entry.eventName === "PreToolUse");
    expect(disabledEntry).toBeTruthy();
    expect(modifiedEntry).toBeTruthy();

    const userConfigWithDisabledHook = TOML.parse(readFileSync(userConfigPath, "utf8"));
    userConfigWithDisabledHook.hooks.state[disabledEntry.key].enabled = false;
    writeToml(userConfigPath, userConfigWithDisabledHook);

    const projectConfigWithModifiedHook = TOML.parse(readFileSync(projectConfigPath, "utf8"));
    projectConfigWithModifiedHook.hooks.PreToolUse[0].hooks[0].timeout = 31;
    writeToml(projectConfigPath, projectConfigWithModifiedHook);

    const changedEntries = listManagedHookTrustEntries(scopePaths, { cwd: repoRoot, env });
    expect(changedEntries.find((entry) => entry.key === disabledEntry.key).status).toBe("disabled");
    expect(changedEntries.find((entry) => entry.key === modifiedEntry.key).status).toBe("modified");
    expect(changedEntries.some((entry) => entry.status === "trusted")).toBe(true);
  } finally {
    rmSync(homeDir, { recursive: true, force: true });
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("project uninstall restores prior files and preserves unrelated settings", async () => {
  const repoRoot = mkdtempSync(path.join(tmpdir(), "codex-nexus-project-uninstall-"));
  mkdirSync(path.join(repoRoot, ".git"));
  writeFileSync(path.join(repoRoot, "package.json"), "{}\n", "utf8");

  try {
    writeFileSync(path.join(repoRoot, ".gitignore"), "dist/\n", "utf8");
    mkdirSync(path.join(repoRoot, ".codex"), { recursive: true });
    writeFileSync(
      path.join(repoRoot, ".codex", "config.toml"),
      [
        'model_instructions_file = "custom.md"',
        "[features]",
        "experimental = true",
        "[mcp_servers.nx]",
        'command = "custom-node"',
        'args = ["/tmp/custom-server.js"]'
      ].join("\n") + "\n",
      "utf8"
    );
    writeJson(path.join(repoRoot, ".codex", "hooks.json"), {
      hooks: {
        SessionStart: [
          {
            hooks: [
              {
                type: "command",
                command: "echo keep-session-start"
              }
            ]
          }
        ]
      }
    });
    writeFileSync(path.join(repoRoot, ".codex", "lead.instructions.md"), "original lead instructions\n", "utf8");
    mkdirSync(path.join(repoRoot, ".codex", "agents"), { recursive: true });
    writeFileSync(path.join(repoRoot, ".codex", "agents", "custom.txt"), "keep me\n", "utf8");

    writeJson(path.join(repoRoot, ".agents", "plugins", "marketplace.json"), {
      name: "custom-marketplace",
      interface: {
        displayName: "Custom Marketplace"
      },
      plugins: [
        {
          name: "other-plugin",
          source: {
            source: "local",
            path: "./plugins/other-plugin"
          }
        }
      ]
    });
    mkdirSync(path.join(repoRoot, ".agents", "skills", "custom-skill"), { recursive: true });
    writeFileSync(path.join(repoRoot, ".agents", "skills", "custom-skill", "SKILL.md"), "custom skill\n", "utf8");

    mkdirSync(path.join(repoRoot, "plugins", "codex-nexus", ".codex-plugin"), { recursive: true });
    writeJson(path.join(repoRoot, "plugins", "codex-nexus", ".codex-plugin", "plugin.json"), { name: "original-plugin" });
    writeFileSync(path.join(repoRoot, "plugins", "codex-nexus", "marker.txt"), "restore me\n", "utf8");

    const env = testEnv();
    const installResult = await installCommand({ scope: "project" }, { cwd: repoRoot, env, inlineHooksSupported: false });
    expect(installResult.uninstallMode).toBe("restore");
    expect(existsSync(installResult.managedStatePath)).toBe(true);

    const uninstallResult = await uninstallCommand({ scope: "project" }, { cwd: repoRoot, env });
    expect(uninstallResult.mode).toBe("restore");
    expect(existsSync(installResult.managedStatePath)).toBe(false);

    const config = TOML.parse(readFileSync(path.join(repoRoot, ".codex", "config.toml"), "utf8"));
    expect(config.model_instructions_file).toBe("custom.md");
    expect(config.features.experimental).toBe(true);
    expect(config.features.multi_agent).toBeUndefined();
    expect(config.mcp_servers.nx.command).toBe("custom-node");
    expect(config.mcp_servers.nx.args).toEqual(["/tmp/custom-server.js"]);

    const hooks = readJson(path.join(repoRoot, ".codex", "hooks.json"));
    expect(JSON.stringify(hooks)).toContain("keep-session-start");
    expect(JSON.stringify(hooks)).not.toContain("codex-nexus-hook");

    const marketplace = readJson(path.join(repoRoot, ".agents", "plugins", "marketplace.json"));
    expect(marketplace.name).toBe("custom-marketplace");
    expect(marketplace.interface.displayName).toBe("Custom Marketplace");
    expect(marketplace.plugins).toHaveLength(1);
    expect(marketplace.plugins[0].name).toBe("other-plugin");

    expect(readFileSync(path.join(repoRoot, ".gitignore"), "utf8")).toBe("dist/\n");
    expect(readFileSync(path.join(repoRoot, ".codex", "lead.instructions.md"), "utf8")).toBe("original lead instructions\n");
    expect(readFileSync(path.join(repoRoot, ".codex", "agents", "custom.txt"), "utf8")).toBe("keep me\n");
    expect(existsSync(path.join(repoRoot, ".codex", "agents", "lead.toml"))).toBe(false);
    expect(readFileSync(path.join(repoRoot, ".agents", "skills", "custom-skill", "SKILL.md"), "utf8")).toBe("custom skill\n");
    expect(existsSync(path.join(repoRoot, ".agents", "skills", "nx-plan", "SKILL.md"))).toBe(false);
    expect(readJson(path.join(repoRoot, "plugins", "codex-nexus", ".codex-plugin", "plugin.json"))).toEqual({ name: "original-plugin" });
    expect(readFileSync(path.join(repoRoot, "plugins", "codex-nexus", "marker.txt"), "utf8")).toBe("restore me\n");
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("user uninstall restores prior files for home-scoped installs", async () => {
  const homeDir = mkdtempSync(path.join(tmpdir(), "codex-nexus-home-uninstall-"));
  const workDir = mkdtempSync(path.join(tmpdir(), "codex-nexus-work-uninstall-"));

  try {
    mkdirSync(path.join(homeDir, ".codex", "agents"), { recursive: true });
    writeFileSync(path.join(homeDir, ".codex", "agents", "custom.txt"), "keep user agent\n", "utf8");
    writeFileSync(path.join(homeDir, ".codex", "lead.instructions.md"), "user lead\n", "utf8");
    writeFileSync(path.join(homeDir, ".codex", "config.toml"), "[features]\nother = true\n", "utf8");
    writeJson(path.join(homeDir, ".codex", "hooks.json"), {
      hooks: {
        SessionStart: [{ hooks: [{ type: "command", command: "echo keep-user-hook" }] }]
      }
    });
    mkdirSync(path.join(homeDir, ".agents", "skills", "custom"), { recursive: true });
    writeFileSync(path.join(homeDir, ".agents", "skills", "custom", "SKILL.md"), "user custom skill\n", "utf8");
    writeJson(path.join(homeDir, ".agents", "plugins", "marketplace.json"), {
      plugins: [{ name: "keep-user-plugin", source: { source: "local", path: "./keep" } }]
    });

    const env = testEnv({ HOME: homeDir });
    const installResult = await installCommand({ scope: "user" }, { cwd: workDir, env, inlineHooksSupported: false });
    expect(installResult.uninstallMode).toBe("restore");

    const uninstallResult = await uninstallCommand({ scope: "user" }, { cwd: workDir, env });
    expect(uninstallResult.mode).toBe("restore");

    const config = TOML.parse(readFileSync(path.join(homeDir, ".codex", "config.toml"), "utf8"));
    expect(config.features.other).toBe(true);
    expect(config.features.multi_agent).toBeUndefined();
    expect(readFileSync(path.join(homeDir, ".codex", "lead.instructions.md"), "utf8")).toBe("user lead\n");
    expect(readFileSync(path.join(homeDir, ".codex", "agents", "custom.txt"), "utf8")).toBe("keep user agent\n");
    expect(existsSync(path.join(homeDir, ".codex", "agents", "lead.toml"))).toBe(false);
    expect(readFileSync(path.join(homeDir, ".agents", "skills", "custom", "SKILL.md"), "utf8")).toBe("user custom skill\n");
    expect(existsSync(path.join(homeDir, ".agents", "skills", "nx-run", "SKILL.md"))).toBe(false);
    const hooks = readJson(path.join(homeDir, ".codex", "hooks.json"));
    expect(JSON.stringify(hooks)).toContain("keep-user-hook");
    expect(JSON.stringify(hooks)).not.toContain("codex-nexus-hook");
    const marketplace = readJson(path.join(homeDir, ".agents", "plugins", "marketplace.json"));
    expect(marketplace.plugins).toHaveLength(1);
    expect(marketplace.plugins[0].name).toBe("keep-user-plugin");
  } finally {
    rmSync(homeDir, { recursive: true, force: true });
    rmSync(workDir, { recursive: true, force: true });
  }
});

test("project uninstall preserves user inline hooks when install used config.toml hooks", async () => {
  const repoRoot = mkdtempSync(path.join(tmpdir(), "codex-nexus-project-inline-uninstall-"));
  mkdirSync(path.join(repoRoot, ".git"));
  writeFileSync(path.join(repoRoot, "package.json"), "{}\n", "utf8");

  try {
    writeToml(path.join(repoRoot, ".codex", "config.toml"), {
      features: {
        experimental: true
      },
      hooks: {
        SessionStart: [
          {
            matcher: "startup",
            hooks: [
              {
                type: "command",
                command: "echo keep-inline-session-start"
              }
            ]
          }
        ]
      }
    });

    const env = testEnv();
    const installResult = await installCommand({ scope: "project" }, { cwd: repoRoot, env, inlineHooksSupported: true });
    expect(installResult.uninstallMode).toBe("restore");
    expect(installResult.hooksSurface).toBe("config.toml");
    expect(existsSync(path.join(repoRoot, ".codex", "hooks.json"))).toBe(false);

    const uninstallResult = await uninstallCommand({ scope: "project" }, { cwd: repoRoot, env });
    expect(uninstallResult.mode).toBe("restore");

    const config = TOML.parse(readFileSync(path.join(repoRoot, ".codex", "config.toml"), "utf8"));
    expect(config.features.experimental).toBe(true);
    expect(config.features.multi_agent).toBeUndefined();
    expect(config.hooks.SessionStart[0].hooks[0].command).toBe("echo keep-inline-session-start");
    expect(JSON.stringify(config)).not.toContain("codex-nexus-hook");
    expect(existsSync(path.join(repoRoot, ".codex", "hooks.json"))).toBe(false);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("uninstall falls back to best-effort cleanup when rollback metadata is missing", async () => {
  const repoRoot = mkdtempSync(path.join(tmpdir(), "codex-nexus-project-fallback-"));
  mkdirSync(path.join(repoRoot, ".git"));
  writeFileSync(path.join(repoRoot, "package.json"), "{}\n", "utf8");

  try {
    writeFileSync(path.join(repoRoot, ".gitignore"), "dist/\n", "utf8");
    mkdirSync(path.join(repoRoot, ".codex"), { recursive: true });
    writeFileSync(path.join(repoRoot, ".codex", "config.toml"), "[features]\nother = true\n", "utf8");
    writeJson(path.join(repoRoot, ".codex", "hooks.json"), {
      hooks: {
        SessionStart: [{ hooks: [{ type: "command", command: "echo keep-fallback-hook" }] }]
      }
    });
    writeJson(path.join(repoRoot, ".agents", "plugins", "marketplace.json"), {
      plugins: [{ name: "keep-fallback-plugin", source: { source: "local", path: "./keep" } }]
    });

    const env = testEnv();
    const installResult = await installCommand({ scope: "project" }, { cwd: repoRoot, env, inlineHooksSupported: false });
    removePath(path.dirname(installResult.managedStatePath));

    const uninstallResult = await uninstallCommand({ scope: "project" }, { cwd: repoRoot, env });
    expect(uninstallResult.mode).toBe("best-effort");
    expect(existsSync(path.join(repoRoot, ".codex", "plugins", "codex-nexus"))).toBe(false);
    expect(existsSync(path.join(repoRoot, ".codex", "lead.instructions.md"))).toBe(false);

    const config = TOML.parse(readFileSync(path.join(repoRoot, ".codex", "config.toml"), "utf8"));
    expect(config.features.other).toBe(true);
    expect(config.features.multi_agent).toBeUndefined();
    expect(config.model_instructions_file).toBeUndefined();

    const hooks = readJson(path.join(repoRoot, ".codex", "hooks.json"));
    expect(JSON.stringify(hooks)).toContain("keep-fallback-hook");
    expect(JSON.stringify(hooks)).not.toContain("codex-nexus-hook");

    const marketplace = readJson(path.join(repoRoot, ".agents", "plugins", "marketplace.json"));
    expect(marketplace.plugins.some((entry) => entry.name === "keep-fallback-plugin")).toBe(true);
    expect(marketplace.plugins.some((entry) => entry.name === "codex-nexus")).toBe(false);
    expect(readFileSync(path.join(repoRoot, ".gitignore"), "utf8")).toContain("dist/");
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("best-effort uninstall strips managed inline hooks and preserves user inline hooks", async () => {
  const repoRoot = mkdtempSync(path.join(tmpdir(), "codex-nexus-project-inline-fallback-"));
  mkdirSync(path.join(repoRoot, ".git"));
  writeFileSync(path.join(repoRoot, "package.json"), "{}\n", "utf8");

  try {
    writeToml(path.join(repoRoot, ".codex", "config.toml"), {
      hooks: {
        SessionStart: [
          {
            matcher: "startup",
            hooks: [
              {
                type: "command",
                command: "echo keep-inline-fallback-hook"
              }
            ]
          }
        ]
      }
    });

    const env = testEnv();
    const installResult = await installCommand({ scope: "project" }, { cwd: repoRoot, env, inlineHooksSupported: true });
    removePath(path.dirname(installResult.managedStatePath));

    const uninstallResult = await uninstallCommand({ scope: "project" }, { cwd: repoRoot, env });
    expect(uninstallResult.mode).toBe("best-effort");

    const config = TOML.parse(readFileSync(path.join(repoRoot, ".codex", "config.toml"), "utf8"));
    expect(config.hooks.SessionStart[0].hooks[0].command).toBe("echo keep-inline-fallback-hook");
    expect(JSON.stringify(config)).not.toContain("codex-nexus-hook");
    expect(existsSync(path.join(repoRoot, ".codex", "hooks.json"))).toBe(false);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("published-style install includes nexus-core dependency", () => {
  const packDir = mkdtempSync(path.join(tmpdir(), "codex-nexus-pack-"));
  const installDir = mkdtempSync(path.join(tmpdir(), "codex-nexus-install-"));

  try {
    const tarballName = execFileSync("npm", ["pack", packageRoot], {
      cwd: packDir,
      encoding: "utf8"
    }).trim().split("\n").pop();

    execFileSync("npm", ["install", "--prefix", installDir, path.join(packDir, tarballName)], {
      encoding: "utf8"
    });

    const installedPackageRoot = path.join(installDir, "node_modules", "codex-nexus");
    const nexusCoreRoot = resolveNexusCorePackageRoot(installedPackageRoot);

    expect(existsSync(path.join(nexusCoreRoot, "package.json"))).toBe(true);
    expect(existsSync(path.join(nexusCoreRoot, "dist", "mcp", "server.js"))).toBe(true);
  } finally {
    rmSync(packDir, { recursive: true, force: true });
    rmSync(installDir, { recursive: true, force: true });
  }
}, 20000);

function removePath(filePath) {
  rmSync(filePath, { recursive: true, force: true });
}
