import { existsSync } from "node:fs";
import path from "node:path";
import { readFile, readdir } from "node:fs/promises";
import { resolveScopePaths, type ScopePaths, type SetupScope } from "../shared/paths.js";

export interface DoctorCheck {
  group: "Config" | "Skills" | "Agents";
  label: string;
  ok: boolean;
}

export interface DoctorResult {
  scope: SetupScope;
  codexHomeDir: string;
  failed: number;
  checks: DoctorCheck[];
}

const FALLBACK_AGENT_IDS = [
  "lead",
  "architect",
  "designer",
  "postdoc",
  "strategist",
  "engineer",
  "researcher",
  "writer",
  "reviewer",
  "tester"
];

const FALLBACK_SKILL_IDS = ["nx-init", "nx-plan", "nx-run", "nx-sync"];

async function listManagedEntries(
  scopePaths: ScopePaths,
  relativeDir: string,
  extension: string,
  fallback: string[]
): Promise<string[]> {
  const managedDir = path.join(
    scopePaths.packageStoreDir,
    "node_modules",
    "codex-nexus",
    relativeDir
  );

  if (!existsSync(managedDir)) {
    return fallback;
  }

  const entries = await readdir(managedDir, { withFileTypes: true });
  const values = entries
    .filter((entry) => {
      if (extension === "/") return entry.isDirectory();
      return entry.isFile() && entry.name.endsWith(extension);
    })
    .map((entry) => extension === "/" ? entry.name : entry.name.slice(0, -extension.length))
    .sort();

  return values.length > 0 ? values : fallback;
}

async function hasStandaloneAgentRole(agentPath: string, agentName: string): Promise<boolean> {
  if (!existsSync(agentPath)) {
    return false;
  }

  const content = await readFile(agentPath, "utf8");
  return (
    content.includes(`name = "${agentName}"`) &&
    content.includes('developer_instructions = """') &&
    !content.includes("[agents.")
  );
}

export function formatDoctorSummary(result: DoctorResult): string {
  const lines = [
    "codex-nexus doctor",
    `Scope: ${result.scope}`,
    `Codex home: ${result.codexHomeDir}`,
    ""
  ];

  const groups: DoctorCheck["group"][] = ["Config", "Skills", "Agents"];
  for (const group of groups) {
    lines.push(`${group}:`);
    for (const check of result.checks.filter((entry) => entry.group === group)) {
      lines.push(`  ${check.ok ? "[ok]" : "[xx]"} ${check.label}`);
    }
    lines.push("");
  }

  lines.push(result.failed === 0 ? "Doctor passed." : `Doctor found ${result.failed} issue(s).`);
  return lines.join("\n").trimEnd();
}

export async function doctorCommand(scope: SetupScope): Promise<DoctorResult> {
  const scopePaths = resolveScopePaths(scope);
  const managedSkills = await listManagedEntries(scopePaths, path.join("plugin", "skills"), "/", FALLBACK_SKILL_IDS);
  const managedAgents = await listManagedEntries(scopePaths, "agents", ".toml", FALLBACK_AGENT_IDS);
  const checks: DoctorCheck[] = [
    { group: "Config", label: "config.toml", ok: existsSync(scopePaths.configTomlPath) },
    { group: "Config", label: "hooks.json", ok: existsSync(scopePaths.hooksJsonPath) },
    { group: "Config", label: "AGENTS.md", ok: existsSync(scopePaths.agentsMdPath) }
  ];

  for (const name of managedSkills) {
    checks.push({
      group: "Skills",
      label: `skills/${name}`,
      ok: existsSync(path.join(scopePaths.skillsDir, name, "SKILL.md"))
    });
  }

  for (const name of managedAgents) {
    checks.push({
      group: "Agents",
      label: `agents/${name}.toml`,
      ok: await hasStandaloneAgentRole(path.join(scopePaths.agentsDir, `${name}.toml`), name)
    });
  }

  const failed = checks.filter((check) => !check.ok).length;
  return {
    scope,
    codexHomeDir: scopePaths.codexHomeDir,
    failed,
    checks
  };
}
