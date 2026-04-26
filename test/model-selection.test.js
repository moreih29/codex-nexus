import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import TOML from "@iarna/toml";
import {
  installCommand,
  modelsCommand,
  parseCodexModelCatalogOutput,
  removeTopLevelTomlKey,
  runCli,
  setTopLevelTomlString
} from "../scripts/codex-nexus.mjs";

const packageRoot = path.resolve(path.join(import.meta.dir, ".."));
const modelCatalog = [
  { slug: "gpt-5.5", display_name: "GPT-5.5", visibility: "list" },
  { slug: "gpt-5.4", display_name: "gpt-5.4", visibility: "list" },
  { slug: "gpt-5.3-codex", display_name: "gpt-5.3-codex", visibility: "list" }
];

function makeProject() {
  const repoRoot = mkdtempSync(path.join(tmpdir(), "codex-nexus-models-"));
  mkdirSync(path.join(repoRoot, ".git"));
  return repoRoot;
}

function writeAgent(repoRoot, agent, content = null) {
  const agentPath = path.join(repoRoot, ".codex", "agents", `${agent}.toml`);
  mkdirSync(path.dirname(agentPath), { recursive: true });
  writeFileSync(agentPath, content ?? `name = "${agent}"\nmodel = "gpt-5.3-codex"\n\n[mcp_servers.nx]\ncommand = "nexus-mcp"\n`, "utf8");
  return agentPath;
}

function readToml(filePath) {
  return TOML.parse(readFileSync(filePath, "utf8"));
}

function testEnv(extra = {}) {
  return {
    ...process.env,
    CODEX_NEXUS_TEST_PACKAGE_ROOT: packageRoot,
    ...extra
  };
}

test("Codex model catalog parser keeps visible list models only", () => {
  const parsed = parseCodexModelCatalogOutput(JSON.stringify({
    models: [
      { slug: "gpt-5.4", display_name: "gpt-5.4", visibility: "list" },
      { slug: "codex-auto-review", display_name: "Codex Auto Review", visibility: "hide" },
      { slug: "gpt-5.3-codex", display_name: "gpt-5.3-codex", visibility: "list" }
    ]
  }));

  expect(parsed.map((entry) => entry.slug)).toEqual(["gpt-5.4", "gpt-5.3-codex"]);
});

test("setTopLevelTomlString preserves multiline instructions and tables", () => {
  const before = `name = "engineer"\ndeveloper_instructions = """\nKeep this text.\n[not_a_table]\n"""\nmodel = "gpt-5.3-codex"\n\n[mcp_servers.nx]\ncommand = "nexus-mcp"\ndisabled_tools = ["spawn_agent"]\n`;
  const after = setTopLevelTomlString(before, "model", "gpt-5.4", "engineer.toml");
  const parsed = TOML.parse(after);

  expect(parsed.model).toBe("gpt-5.4");
  expect(parsed.developer_instructions).toContain("[not_a_table]");
  expect(parsed.mcp_servers.nx.command).toBe("nexus-mcp");
  expect(parsed.mcp_servers.nx.disabled_tools).toEqual(["spawn_agent"]);
});

test("removeTopLevelTomlKey preserves multiline instructions and tables", () => {
  const before = `name = "engineer"\ndeveloper_instructions = """\nKeep this text.\n[not_a_table]\n"""\nmodel = "gpt-5.3-codex"\nsandbox_mode = "read-only"\n\n[mcp_servers.nx]\ncommand = "nexus-mcp"\ndisabled_tools = ["spawn_agent"]\n`;
  const after = removeTopLevelTomlKey(before, "model", "engineer.toml");
  const parsed = TOML.parse(after);

  expect(parsed.model).toBeUndefined();
  expect(parsed.developer_instructions).toContain("[not_a_table]");
  expect(parsed.sandbox_mode).toBe("read-only");
  expect(parsed.mcp_servers.nx.command).toBe("nexus-mcp");
  expect(parsed.mcp_servers.nx.disabled_tools).toEqual(["spawn_agent"]);
});

test("models command writes default and selected non-lead agent TOMLs", async () => {
  const repoRoot = makeProject();
  try {
    const engineerPath = writeAgent(repoRoot, "engineer");
    const leadPath = writeAgent(repoRoot, "lead", 'name = "lead"\nmodel = "gpt-5.4"\n');

    const result = await modelsCommand(
      { scope: "project", targets: "default,engineer", model: "gpt-5.4" },
      { cwd: repoRoot, modelCatalog }
    );

    expect(result.applied.map((entry) => entry.target)).toEqual(["default", "engineer"]);
    expect(readToml(path.join(repoRoot, ".codex", "config.toml")).model).toBe("gpt-5.4");
    expect(readToml(engineerPath).model).toBe("gpt-5.4");
    expect(readToml(leadPath).model).toBe("gpt-5.4");

    const overrides = JSON.parse(readFileSync(path.join(repoRoot, ".codex", ".codex-nexus", "model-overrides.json"), "utf8"));
    expect(overrides.targets).toEqual({ default: "gpt-5.4", engineer: "gpt-5.4" });
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("models command supports inherit by removing model fields and persisted overrides", async () => {
  const repoRoot = makeProject();
  try {
    const engineerPath = writeAgent(repoRoot, "engineer");

    await modelsCommand(
      { scope: "project", targets: "default,engineer", model: "gpt-5.5" },
      { cwd: repoRoot, modelCatalog }
    );
    await modelsCommand(
      { scope: "project", targets: "engineer", model: "inherit" },
      { cwd: repoRoot, modelCatalog }
    );

    expect(readToml(path.join(repoRoot, ".codex", "config.toml")).model).toBe("gpt-5.5");
    expect(readToml(engineerPath).model).toBeUndefined();

    const overrides = JSON.parse(readFileSync(path.join(repoRoot, ".codex", ".codex-nexus", "model-overrides.json"), "utf8"));
    expect(overrides.targets).toEqual({ default: "gpt-5.5" });
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("models command inherit can clear the scoped default model without creating missing config", async () => {
  const repoRoot = makeProject();
  try {
    await modelsCommand(
      { scope: "project", targets: "default", model: "inherit" },
      { cwd: repoRoot, modelCatalog }
    );

    expect(existsSync(path.join(repoRoot, ".codex", "config.toml"))).toBe(false);

    await modelsCommand(
      { scope: "project", targets: "default", model: "gpt-5.5" },
      { cwd: repoRoot, modelCatalog }
    );
    await modelsCommand(
      { scope: "project", targets: "default", model: "inherit" },
      { cwd: repoRoot, modelCatalog }
    );

    expect(readToml(path.join(repoRoot, ".codex", "config.toml")).model).toBeUndefined();

    const overrides = JSON.parse(readFileSync(path.join(repoRoot, ".codex", ".codex-nexus", "model-overrides.json"), "utf8"));
    expect(overrides.targets).toEqual({});
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("models command rejects lead, unknown targets, and unsupported models", async () => {
  const repoRoot = makeProject();
  try {
    writeAgent(repoRoot, "engineer");

    await expect(modelsCommand(
      { scope: "project", targets: "lead", model: "gpt-5.4" },
      { cwd: repoRoot, modelCatalog }
    )).rejects.toThrow("lead agent cannot be configured");

    await expect(modelsCommand(
      { scope: "project", targets: "unknown", model: "gpt-5.4" },
      { cwd: repoRoot, modelCatalog }
    )).rejects.toThrow("Unknown model target");

    await expect(modelsCommand(
      { scope: "project", targets: "engineer", model: "not-a-model" },
      { cwd: repoRoot, modelCatalog }
    )).rejects.toThrow("not available");
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("models command validates all targets before writing", async () => {
  const repoRoot = makeProject();
  try {
    writeAgent(repoRoot, "engineer", "not valid toml =\n");

    await expect(modelsCommand(
      { scope: "project", targets: "default,engineer", model: "gpt-5.4" },
      { cwd: repoRoot, modelCatalog }
    )).rejects.toThrow();

    expect(existsSync(path.join(repoRoot, ".codex", "config.toml"))).toBe(false);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("models command writes user scope when requested", async () => {
  const homeDir = mkdtempSync(path.join(tmpdir(), "codex-nexus-models-home-"));
  const workDir = mkdtempSync(path.join(tmpdir(), "codex-nexus-models-work-"));
  try {
    mkdirSync(path.join(homeDir, ".codex", "agents"), { recursive: true });
    writeFileSync(path.join(homeDir, ".codex", "agents", "tester.toml"), 'name = "tester"\nmodel = "gpt-5.3-codex"\n', "utf8");

    await modelsCommand(
      { scope: "user", targets: "default,tester", model: "gpt-5.5" },
      { cwd: workDir, env: testEnv({ HOME: homeDir }), modelCatalog }
    );

    expect(readToml(path.join(homeDir, ".codex", "config.toml")).model).toBe("gpt-5.5");
    expect(readToml(path.join(homeDir, ".codex", "agents", "tester.toml")).model).toBe("gpt-5.5");
  } finally {
    rmSync(homeDir, { recursive: true, force: true });
    rmSync(workDir, { recursive: true, force: true });
  }
});

test("persisted model overrides are reapplied after install", async () => {
  const repoRoot = makeProject();
  try {
    const env = testEnv();
    await installCommand({ scope: "project" }, { cwd: repoRoot, env, inlineHooksSupported: false });
    await modelsCommand(
      { scope: "project", targets: "default,engineer", model: "gpt-5.5" },
      { cwd: repoRoot, env, modelCatalog }
    );

    await installCommand({ scope: "project" }, { cwd: repoRoot, env, inlineHooksSupported: false });

    expect(readToml(path.join(repoRoot, ".codex", "config.toml")).model).toBe("gpt-5.5");
    expect(readToml(path.join(repoRoot, ".codex", "agents", "engineer.toml")).model).toBe("gpt-5.5");
    expect(readToml(path.join(repoRoot, ".codex", "agents", "lead.toml")).model).toBeUndefined();
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("inherit removes persisted agent override across reinstall", async () => {
  const repoRoot = makeProject();
  try {
    const env = testEnv();
    await installCommand({ scope: "project" }, { cwd: repoRoot, env, inlineHooksSupported: false });
    await modelsCommand(
      { scope: "project", targets: "default,engineer", model: "gpt-5.5" },
      { cwd: repoRoot, env, modelCatalog }
    );
    await modelsCommand(
      { scope: "project", targets: "engineer", model: "inherit" },
      { cwd: repoRoot, env, modelCatalog }
    );

    await installCommand({ scope: "project" }, { cwd: repoRoot, env, inlineHooksSupported: false });

    expect(readToml(path.join(repoRoot, ".codex", "config.toml")).model).toBe("gpt-5.5");
    expect(readToml(path.join(repoRoot, ".codex", "agents", "engineer.toml")).model).toBeUndefined();
    expect(readToml(path.join(repoRoot, ".codex", "agents", "lead.toml")).model).toBeUndefined();
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("runCli supports --targets and --agents alias in direct mode", async () => {
  for (const flag of ["--targets", "--agents"]) {
    const repoRoot = makeProject();
    try {
      writeAgent(repoRoot, "reviewer");
      let stdout = "";
      const originalWrite = process.stdout.write;
      process.stdout.write = (chunk, ...args) => {
        stdout += String(chunk);
        if (typeof args.at(-1) === "function") {
          args.at(-1)();
        }
        return true;
      };
      try {
        const exitCode = await runCli(
          ["node", "codex-nexus", "models", "--scope", "project", flag, "reviewer", "--model", "gpt-5.4"],
          { cwd: repoRoot, modelCatalog }
        );
        expect(exitCode).toBe(0);
      } finally {
        process.stdout.write = originalWrite;
      }

      expect(stdout).toContain("codex-nexus models complete");
      expect(readToml(path.join(repoRoot, ".codex", "agents", "reviewer.toml")).model).toBe("gpt-5.4");
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  }
});

test("runCli direct inherit does not require a Codex model catalog", async () => {
  const repoRoot = makeProject();
  try {
    writeAgent(repoRoot, "reviewer", 'name = "reviewer"\nmodel = "gpt-5.3-codex"\n');
    let stdout = "";
    const originalWrite = process.stdout.write;
    process.stdout.write = (chunk, ...args) => {
      stdout += String(chunk);
      if (typeof args.at(-1) === "function") {
        args.at(-1)();
      }
      return true;
    };
    try {
      const exitCode = await runCli(
        ["node", "codex-nexus", "models", "--scope", "project", "--targets", "reviewer", "--model", "inherit"],
        { cwd: repoRoot }
      );
      expect(exitCode).toBe(0);
    } finally {
      process.stdout.write = originalWrite;
    }

    expect(stdout).toContain("reviewer -> inherit");
    expect(readToml(path.join(repoRoot, ".codex", "agents", "reviewer.toml")).model).toBeUndefined();
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});
