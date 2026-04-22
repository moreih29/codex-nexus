import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { doctorCommand, fetchPublishedVersions, installCommand } from "../scripts/codex-nexus.mjs";

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
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
    const result = await installCommand({ scope: "project", version: "0.3.0" }, { cwd: repoRoot, env });

    expect(result.scope).toBe("project");
    expect(existsSync(path.join(repoRoot, "plugins", "codex-nexus", ".codex-plugin", "plugin.json"))).toBe(true);
    expect(existsSync(path.join(repoRoot, ".codex", "lead.instructions.md"))).toBe(true);
    expect(existsSync(path.join(repoRoot, ".codex", "agents", "lead.toml"))).toBe(true);
    expect(existsSync(path.join(repoRoot, ".agents", "skills", "nx-plan", "SKILL.md"))).toBe(true);
    expect(readFileSync(path.join(repoRoot, ".codex", "config.toml"), "utf8")).toContain('model_instructions_file = "lead.instructions.md"');
    expect(readFileSync(path.join(repoRoot, ".codex", "config.toml"), "utf8")).toContain("multi_agent = true");
    expect(readFileSync(path.join(repoRoot, ".codex", "hooks.json"), "utf8")).toContain(path.resolve(path.join(import.meta.dir, "..", "scripts", "codex-nexus-hook.mjs")));
    expect(readFileSync(path.join(repoRoot, ".gitignore"), "utf8")).toContain(".codex/config.toml");

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
    const result = await installCommand({ scope: "user", version: "0.3.0" }, { cwd: workDir, env });

    expect(result.scope).toBe("user");
    expect(existsSync(path.join(homeDir, ".codex", "plugins", "codex-nexus", ".codex-plugin", "plugin.json"))).toBe(true);
    expect(existsSync(path.join(homeDir, ".codex", "agents", "lead.toml"))).toBe(true);
    expect(existsSync(path.join(homeDir, ".agents", "skills", "nx-run", "SKILL.md"))).toBe(true);

    const marketplace = readJson(path.join(homeDir, ".agents", "plugins", "marketplace.json"));
    expect(marketplace.plugins[0].source.path).toBe("./.codex/plugins/codex-nexus");

    const doctor = doctorCommand({ scope: "user" }, { cwd: workDir, env });
    expect(doctor.failed).toBe(0);
  } finally {
    rmSync(homeDir, { recursive: true, force: true });
    rmSync(workDir, { recursive: true, force: true });
  }
});

test("published versions are filtered to compatible releases only", async () => {
  const versions = await fetchPublishedVersions({
    env: {
      ...process.env,
      CODEX_NEXUS_TEST_VERSIONS: JSON.stringify(["0.1.0", "0.2.3", "0.3.0", "0.3.1"])
    }
  });

  expect(versions).toEqual(["0.3.0", "0.3.1"]);
});
