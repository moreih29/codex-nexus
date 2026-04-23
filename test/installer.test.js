import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import TOML from "@iarna/toml";
import { doctorCommand, installCommand, resolveNexusCorePackageRoot } from "../scripts/codex-nexus.mjs";

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
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

test("project install wires plugin, config, hooks, agents, and skills", async () => {
  const repoRoot = mkdtempSync(path.join(tmpdir(), "codex-nexus-project-"));
  mkdirSync(path.join(repoRoot, ".git"));
  writeFileSync(path.join(repoRoot, "package.json"), "{}\n", "utf8");

  try {
    const env = {
      ...process.env,
      CODEX_NEXUS_TEST_PACKAGE_ROOT: path.resolve(path.join(import.meta.dir, ".."))
    };
    const result = await installCommand({ scope: "project" }, { cwd: repoRoot, env });

    expect(result.scope).toBe("project");
    expect(existsSync(path.join(repoRoot, "plugins", "codex-nexus", ".codex-plugin", "plugin.json"))).toBe(true);
    expect(existsSync(path.join(repoRoot, ".codex", "lead.instructions.md"))).toBe(true);
    expect(existsSync(path.join(repoRoot, ".codex", "agents", "lead.toml"))).toBe(true);
    expect(existsSync(path.join(repoRoot, ".agents", "skills", "nx-plan", "SKILL.md"))).toBe(true);
    expect(readFileSync(path.join(repoRoot, ".codex", "config.toml"), "utf8")).toContain('model_instructions_file = "lead.instructions.md"');
    expect(readFileSync(path.join(repoRoot, ".codex", "config.toml"), "utf8")).toContain("multi_agent = true");
    expect(readFileSync(path.join(repoRoot, ".codex", "config.toml"), "utf8")).not.toContain('command = "npx"');
    expect(readFileSync(path.join(repoRoot, ".codex", "config.toml"), "utf8")).toContain("dist/mcp/server.js");
    expect(readFileSync(path.join(repoRoot, ".codex", "hooks.json"), "utf8")).toContain(path.resolve(path.join(import.meta.dir, "..", "scripts", "codex-nexus-hook.mjs")));
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
      expect(agent.nx.command).toBe(result.runtimeCommand);
      expect(agent.nx.args).toEqual([result.nexusCoreServerPath]);
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
    const env = {
      ...process.env,
      HOME: homeDir,
      CODEX_NEXUS_TEST_PACKAGE_ROOT: path.resolve(path.join(import.meta.dir, ".."))
    };
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
      expect(agent.nx.command).toBe(result.runtimeCommand);
      expect(agent.nx.args).toEqual([result.nexusCoreServerPath]);
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

test("published-style install includes nexus-core dependency", () => {
  const packDir = mkdtempSync(path.join(tmpdir(), "codex-nexus-pack-"));
  const installDir = mkdtempSync(path.join(tmpdir(), "codex-nexus-install-"));

  try {
    const tarballName = execFileSync("npm", ["pack", path.resolve(path.join(import.meta.dir, ".."))], {
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
