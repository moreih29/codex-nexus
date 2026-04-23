import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import TOML from "@iarna/toml";
import {
  doctorCommand,
  installCommand,
  resolveNexusCorePackageRoot,
  uninstallCommand
} from "../scripts/codex-nexus.mjs";

const packageRoot = path.resolve(path.join(import.meta.dir, ".."));
const cliPath = path.join(packageRoot, "scripts", "codex-nexus.mjs");
const pkg = JSON.parse(readFileSync(path.join(packageRoot, "package.json"), "utf8"));

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readAgentNxConfigs(agentDir) {
  return ["architect.toml", "designer.toml", "engineer.toml", "postdoc.toml", "researcher.toml", "reviewer.toml", "strategist.toml", "tester.toml", "writer.toml"]
    .filter((entry) => existsSync(path.join(agentDir, entry)))
    .map((entry) => {
      const parsed = TOML.parse(readFileSync(path.join(agentDir, entry), "utf8"));
      return {
        file: entry,
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
    const result = await installCommand({ scope: "project" }, { cwd: repoRoot, env });

    expect(result.scope).toBe("project");
    expect(existsSync(path.join(repoRoot, "plugins", "codex-nexus", ".codex-plugin", "plugin.json"))).toBe(true);
    expect(existsSync(path.join(repoRoot, ".codex", "lead.instructions.md"))).toBe(true);
    expect(existsSync(path.join(repoRoot, ".codex", "agents", "lead.toml"))).toBe(true);
    expect(existsSync(path.join(repoRoot, ".agents", "skills", "nx-plan", "SKILL.md"))).toBe(true);
    expect(existsSync(result.managedStatePath)).toBe(true);
    expect(readFileSync(path.join(repoRoot, ".codex", "config.toml"), "utf8")).toContain('model_instructions_file = "lead.instructions.md"');
    expect(readFileSync(path.join(repoRoot, ".codex", "config.toml"), "utf8")).toContain("multi_agent = true");
    expect(readFileSync(path.join(repoRoot, ".codex", "config.toml"), "utf8")).not.toContain('command = "npx"');
    expect(readFileSync(path.join(repoRoot, ".codex", "config.toml"), "utf8")).toContain("dist/mcp/server.js");
    const hooksContent = readFileSync(path.join(repoRoot, ".codex", "hooks.json"), "utf8");
    expect(hooksContent).toContain(path.resolve(path.join(packageRoot, "scripts", "codex-nexus-hook.mjs")));
    expect(hooksContent).toContain("permission-request");
    expect(hooksContent).toContain("stop");
    expect(readFileSync(path.join(repoRoot, ".gitignore"), "utf8")).toContain(".codex/");
    expect(readFileSync(path.join(repoRoot, ".gitignore"), "utf8")).toContain(".agents/");
    const installedAgentNxConfigs = readAgentNxConfigs(path.join(repoRoot, ".codex", "agents"));
    expect(installedAgentNxConfigs.length).toBeGreaterThan(0);
    for (const agent of installedAgentNxConfigs) {
      expect(agent.nx.command).toBe(result.runtimeCommand);
      expect(agent.nx.args).toEqual([result.nexusCoreServerPath]);
      expect(Array.isArray(agent.nx.disabled_tools)).toBe(true);
    }
    const installedPluginAgentNxConfigs = readAgentNxConfigs(path.join(repoRoot, "plugins", "codex-nexus", "agents"));
    expect(installedPluginAgentNxConfigs.length).toBeGreaterThan(0);
    for (const agent of installedPluginAgentNxConfigs) {
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
    const result = await installCommand({ scope: "user" }, { cwd: workDir, env });

    expect(result.scope).toBe("user");
    expect(existsSync(path.join(homeDir, ".codex", "plugins", "codex-nexus", ".codex-plugin", "plugin.json"))).toBe(true);
    expect(existsSync(path.join(homeDir, ".codex", "agents", "lead.toml"))).toBe(true);
    expect(existsSync(path.join(homeDir, ".agents", "skills", "nx-run", "SKILL.md"))).toBe(true);
    expect(readFileSync(path.join(homeDir, ".codex", "config.toml"), "utf8")).not.toContain('command = "npx"');
    expect(readFileSync(path.join(homeDir, ".codex", "config.toml"), "utf8")).toContain("dist/mcp/server.js");
    const installedAgentNxConfigs = readAgentNxConfigs(path.join(homeDir, ".codex", "agents"));
    expect(installedAgentNxConfigs.length).toBeGreaterThan(0);
    for (const agent of installedAgentNxConfigs) {
      expect(agent.nx.command).toBe(result.runtimeCommand);
      expect(agent.nx.args).toEqual([result.nexusCoreServerPath]);
      expect(Array.isArray(agent.nx.disabled_tools)).toBe(true);
    }
    const installedPluginAgentNxConfigs = readAgentNxConfigs(path.join(homeDir, ".codex", "plugins", "codex-nexus", "agents"));
    expect(installedPluginAgentNxConfigs.length).toBeGreaterThan(0);
    for (const agent of installedPluginAgentNxConfigs) {
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
    const installResult = await installCommand({ scope: "project" }, { cwd: repoRoot, env });
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
    const installResult = await installCommand({ scope: "user" }, { cwd: workDir, env });
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
    const installResult = await installCommand({ scope: "project" }, { cwd: repoRoot, env });
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
