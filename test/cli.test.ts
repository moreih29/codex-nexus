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
        CODEX_NEXUS_FORCE_TTY: "0",
        CODEX_NEXUS_TEST_PACKAGE_ROOT: process.cwd(),
        CODEX_NEXUS_TEST_VERSIONS: JSON.stringify([getCurrentVersion()])
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
  test("defaults to install when no command is provided", () => {
    expect(parseCliArgs([])).toEqual({
      kind: "command",
      command: "install",
      options: {
        verbose: false,
        coreOnly: false
      }
    });
  });

  test("parses install with explicit scope, version, verbose, and core-only mode", () => {
    expect(parseCliArgs(["install", "--scope", "project", "--version", "0.1.0", "--verbose", "--core-only"])).toEqual({
      kind: "command",
      command: "install",
      options: {
        scope: "project",
        version: "0.1.0",
        verbose: true,
        coreOnly: true
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
    expect(parseCliArgs(["install", "--scope", "workspace"])).toEqual({
      kind: "error",
      command: "install",
      message: 'Invalid --scope value "workspace". Expected "user" or "project".'
    });
  });

  test("rejects setup after install-only consolidation", () => {
    expect(parseCliArgs(["setup"])).toEqual({
      kind: "error",
      message: 'Unknown command "setup".'
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

  test("renders install help with version-aware install details", () => {
    const help = renderCommandHelp("install");
    expect(help).toContain("codex-nexus install [options]");
    expect(help).toContain("--version <value>");
    expect(help).toContain("--core-only");
    expect(help).toContain(".codex/packages/node_modules/codex-nexus");
    expect(help).toContain(".codex/config.toml");
    expect(help).toContain(".codex/skills/* (copied from plugin/skills)");
    expect(help).toContain("Scope-specific AGENTS.md lead fragment");
    expect(help).toContain("user: ~/.codex/AGENTS.md");
    expect(help).toContain("project: ./AGENTS.md");
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

      const install = await runCli(["install", "--scope", "project", "--version", getCurrentVersion(), "--verbose"], repoRoot);
      expect(install.code).toBe(0);
      expect(install.stdout).toContain("Install complete.");
      expect(install.stdout).toContain("Scope: project");
      expect(install.stdout).toContain(`Installed version: ${getCurrentVersion()}`);
      expect(install.stdout).toContain("Configured MCP servers: nx, context7");
      expect(install.stdout).toContain("Installed skills");
      expect(existsSync(path.join(repoRoot, ".codex", "config.toml"))).toBe(true);
      expect(existsSync(path.join(repoRoot, ".codex", "hooks.json"))).toBe(true);
      expect(existsSync(path.join(repoRoot, ".codex", "packages"))).toBe(true);
      expect(existsSync(path.join(repoRoot, ".codex", "skills", "nx-plan", "SKILL.md"))).toBe(true);
      expect(existsSync(path.join(repoRoot, ".codex", "agents", "lead.toml"))).toBe(true);
      expect(existsSync(path.join(repoRoot, ".codex", "agents", "architect.toml"))).toBe(true);
      expect(existsSync(path.join(repoRoot, ".codex", "agents", "engineer.toml"))).toBe(true);
      expect(existsSync(path.join(repoRoot, ".codex", "agents", "reviewer.toml"))).toBe(true);
      expect(existsSync(path.join(repoRoot, "AGENTS.md"))).toBe(true);

      const leadToml = await readFile(path.join(repoRoot, ".codex", "agents", "lead.toml"), "utf8");
      const architectToml = await readFile(path.join(repoRoot, ".codex", "agents", "architect.toml"), "utf8");
      const engineerToml = await readFile(path.join(repoRoot, ".codex", "agents", "engineer.toml"), "utf8");
      const reviewerToml = await readFile(path.join(repoRoot, ".codex", "agents", "reviewer.toml"), "utf8");
      const configToml = await readFile(path.join(repoRoot, ".codex", "config.toml"), "utf8");
      const agentsMd = await readFile(path.join(repoRoot, "AGENTS.md"), "utf8");
      expect(leadToml).toContain("[agents.lead]");
      expect(leadToml).toContain('model = "gpt-5.4"');
      expect(architectToml).toContain("[agents.architect]");
      expect(architectToml).toContain('model = "gpt-5.4"');
      expect(architectToml).toContain('sandbox_mode = "read-only"');
      expect(engineerToml).toContain("[agents.engineer]");
      expect(engineerToml).toContain('model = "gpt-5.3-codex"');
      expect(reviewerToml).toContain("[agents.reviewer]");
      expect(reviewerToml).toContain('model = "gpt-5.3-codex"');
      expect(architectToml).not.toContain("[mcp_servers.nx]");
      expect(configToml).toContain("[mcp_servers.context7]");
      expect(configToml).toContain(path.join(process.cwd(), "dist", "mcp", "server.js"));
      expect(configToml).toContain('url = "https://mcp.context7.com/mcp"');
      expect(configToml).toContain('bearer_token_env_var = "CONTEXT7_API_KEY"');
      expect(configToml).toContain("Use optional MCP integrations such as context7");
      expect(agentsMd).toContain("<!-- nexus-core:lead:start -->");
      expect(agentsMd).toContain("# lead");

      const doctor = await runCli(["doctor", "--scope", "project"], repoRoot);
      expect(doctor.code).toBe(0);
      expect(doctor.stdout).toContain("codex-nexus doctor");
      expect(doctor.stdout).toContain("Doctor passed.");
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });

  test("omits the default Context7 MCP entry when install opts out", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "codex-nexus-cli-"));
    try {
      await mkdir(path.join(repoRoot, ".git"));

      const install = await runCli(
        ["install", "--scope", "project", "--version", getCurrentVersion(), "--core-only", "--verbose"],
        repoRoot
      );
      expect(install.code).toBe(0);
      expect(install.stdout).toContain("Configured MCP servers: nx");
      expect(install.stdout).not.toContain("context7");

      const configToml = await readFile(path.join(repoRoot, ".codex", "config.toml"), "utf8");
      expect(configToml).toContain("[mcp_servers.nx]");
      expect(configToml).not.toContain("[mcp_servers.context7]");
      expect(configToml).not.toContain("Use optional MCP integrations such as context7");
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });

  test("user scope installs global AGENTS.md without mutating the current repo AGENTS.md", async () => {
    const homeRoot = await mkdtemp(path.join(os.tmpdir(), "codex-nexus-home-"));
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "codex-nexus-cli-"));
    try {
      const codexHome = path.join(homeRoot, ".codex");
      await mkdir(path.join(repoRoot, ".git"));
      await writeFile(path.join(repoRoot, "AGENTS.md"), "# project instructions\n", "utf8");

      const install = await new Promise<CliResult>((resolve, reject) => {
        const cliPath = path.join(process.cwd(), "dist", "cli", "index.js");
        const child = spawn(process.execPath, [cliPath, "install", "--scope", "user", "--version", getCurrentVersion(), "--verbose"], {
          cwd: repoRoot,
          env: {
            ...process.env,
            HOME: homeRoot,
            CODEX_HOME: codexHome,
            CODEX_NEXUS_FORCE_TTY: "0",
            CODEX_NEXUS_TEST_PACKAGE_ROOT: process.cwd(),
            CODEX_NEXUS_TEST_VERSIONS: JSON.stringify([getCurrentVersion()])
          },
          stdio: ["ignore", "pipe", "pipe"]
        });

        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk) => { stdout += String(chunk); });
        child.stderr.on("data", (chunk) => { stderr += String(chunk); });
        child.on("error", reject);
        child.on("close", (code) => {
          resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() });
        });
      });

      expect(install.code).toBe(0);
      expect(existsSync(path.join(codexHome, "AGENTS.md"))).toBe(true);
      expect(await readFile(path.join(repoRoot, "AGENTS.md"), "utf8")).toBe("# project instructions\n");
      const globalAgents = await readFile(path.join(codexHome, "AGENTS.md"), "utf8");
      expect(globalAgents).toContain("<!-- nexus-core:lead:start -->");

      const doctor = await new Promise<CliResult>((resolve, reject) => {
        const cliPath = path.join(process.cwd(), "dist", "cli", "index.js");
        const child = spawn(process.execPath, [cliPath, "doctor", "--scope", "user"], {
          cwd: repoRoot,
          env: {
            ...process.env,
            HOME: homeRoot,
            CODEX_HOME: codexHome,
            CODEX_NEXUS_FORCE_TTY: "0"
          },
          stdio: ["ignore", "pipe", "pipe"]
        });

        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk) => { stdout += String(chunk); });
        child.stderr.on("data", (chunk) => { stderr += String(chunk); });
        child.on("error", reject);
        child.on("close", (code) => {
          resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() });
        });
      });

      expect(doctor.code).toBe(0);
      expect(doctor.stdout).toContain("Doctor passed.");
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
      await rm(homeRoot, { recursive: true, force: true });
    }
  });
});
