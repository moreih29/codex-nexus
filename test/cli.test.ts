import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { describe, expect, test } from "bun:test";
import { parseCliArgs } from "../src/cli/args.js";
import { renderCommandHelp } from "../src/cli/help.js";
import { getCurrentVersion } from "../src/shared/version.js";

interface CliResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function runCli(args: string[], cwd = process.cwd()): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const cliPath = path.join(process.cwd(), "dist", "cli", "index.js");
    const child = spawn(process.execPath, [cliPath, ...args], {
      cwd,
      env: {
        ...process.env,
        CODEX_NEXUS_FORCE_TTY: "0"
      },
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
      resolve({
        code,
        stdout: stdout.trim(),
        stderr: stderr.trim()
      });
    });
  });
}

describe("CLI parser", () => {
  test("defaults to setup when no command is provided", () => {
    expect(parseCliArgs([])).toEqual({
      kind: "command",
      command: "setup",
      options: {
        verbose: false
      }
    });
  });

  test("parses install alias with explicit scope and verbose", () => {
    expect(parseCliArgs(["install", "--scope", "project", "--verbose"])).toEqual({
      kind: "command",
      command: "install",
      options: {
        scope: "project",
        verbose: true
      }
    });
  });

  test("returns command-specific help when requested", () => {
    expect(parseCliArgs(["doctor", "--help"])).toEqual({
      kind: "help",
      command: "doctor"
    });
  });

  test("rejects invalid scope values", () => {
    expect(parseCliArgs(["setup", "--scope", "workspace"])).toEqual({
      kind: "error",
      command: "setup",
      message: 'Invalid --scope value "workspace". Expected "user" or "project".'
    });
  });
});

describe("CLI help", () => {
  test("renders top-level help with version command", () => {
    const help = renderCommandHelp();
    expect(help).toContain("codex-nexus CLI");
    expect(help).toContain("version   Print the installed codex-nexus version");
    expect(help).toContain("codex-nexus version");
  });

  test("renders setup help with install surface details", () => {
    const help = renderCommandHelp("setup");
    expect(help).toContain("codex-nexus setup [options]");
    expect(help).toContain(".codex/config.toml");
    expect(help).toContain("AGENTS.md Nexus section");
  });
});

describe("CLI integration", () => {
  test("prints help and version from the built CLI", async () => {
    const help = await runCli(["--help"]);
    expect(help.code).toBe(0);
    expect(help.stdout).toContain("codex-nexus CLI");
    expect(help.stdout).toContain("version   Print the installed codex-nexus version");

    const version = await runCli(["version"]);
    expect(version.code).toBe(0);
    expect(version.stdout).toBe(getCurrentVersion());
  });

  test("installs and verifies project scope assets", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "codex-nexus-cli-"));
    try {
      await mkdir(path.join(repoRoot, ".git"));
      await mkdir(path.join(repoRoot, ".codex", "agents"), { recursive: true });
      await writeFile(
        path.join(repoRoot, ".codex", "agents", "nexus.toml"),
        [
          'name = "nexus"',
          'description = "Nexus-aware orchestration lead for plan, run, delegation, and verification workflows"',
          'developer_instructions = """',
          "You are Nexus, the primary orchestration lead for `codex-nexus`.",
          '"""',
          ""
        ].join("\n"),
        "utf8"
      );

      const setup = await runCli(["setup", "--scope", "project", "--verbose"], repoRoot);
      expect(setup.code).toBe(0);
      expect(setup.stdout).toContain("Setup complete.");
      expect(setup.stdout).toContain("Scope: project");
      expect(setup.stdout).toContain("Installed skills");
      expect(existsSync(path.join(repoRoot, ".codex", "config.toml"))).toBe(true);
      expect(existsSync(path.join(repoRoot, ".codex", "hooks.json"))).toBe(true);
      expect(existsSync(path.join(repoRoot, ".codex", "skills", "nx-plan", "SKILL.md"))).toBe(true);
      expect(existsSync(path.join(repoRoot, ".codex", "agents", "nexus.toml"))).toBe(false);
      expect(existsSync(path.join(repoRoot, ".codex", "agents", "architect.toml"))).toBe(true);
      expect(existsSync(path.join(repoRoot, ".codex", "agents", "engineer.toml"))).toBe(true);
      expect(existsSync(path.join(repoRoot, ".codex", "agents", "reviewer.toml"))).toBe(true);
      expect(existsSync(path.join(repoRoot, "AGENTS.md"))).toBe(true);

      const architectToml = await readFile(path.join(repoRoot, ".codex", "agents", "architect.toml"), "utf8");
      const engineerToml = await readFile(path.join(repoRoot, ".codex", "agents", "engineer.toml"), "utf8");
      const reviewerToml = await readFile(path.join(repoRoot, ".codex", "agents", "reviewer.toml"), "utf8");
      expect(architectToml).toContain('model = "gpt-5.4"');
      expect(engineerToml).toContain('model = "gpt-5.3-codex"');
      expect(reviewerToml).toContain('model = "gpt-5.3-codex"');
      expect(architectToml).not.toContain("model_reasoning_effort");
      expect(engineerToml).not.toContain("model_reasoning_effort");
      expect(reviewerToml).not.toContain("model_reasoning_effort");

      const doctor = await runCli(["doctor", "--scope", "project"], repoRoot);
      expect(doctor.code).toBe(0);
      expect(doctor.stdout).toContain("codex-nexus doctor");
      expect(doctor.stdout).toContain("Doctor passed.");
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });
});
