import { existsSync } from "node:fs";
import path from "node:path";
import { AGENT_DEFINITIONS } from "../agents/definitions.js";
import { resolveScopePaths, type SetupScope } from "../shared/paths.js";

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
  const checks: DoctorCheck[] = [
    { group: "Config", label: "config.toml", ok: existsSync(scopePaths.configTomlPath) },
    { group: "Config", label: "hooks.json", ok: existsSync(scopePaths.hooksJsonPath) },
    { group: "Config", label: "AGENTS.md", ok: existsSync(scopePaths.agentsMdPath) },
    { group: "Skills", label: "skills/nx-init", ok: existsSync(path.join(scopePaths.skillsDir, "nx-init", "SKILL.md")) },
    { group: "Skills", label: "skills/nx-plan", ok: existsSync(path.join(scopePaths.skillsDir, "nx-plan", "SKILL.md")) },
    { group: "Skills", label: "skills/nx-run", ok: existsSync(path.join(scopePaths.skillsDir, "nx-run", "SKILL.md")) },
    { group: "Skills", label: "skills/nx-sync", ok: existsSync(path.join(scopePaths.skillsDir, "nx-sync", "SKILL.md")) }
  ];

  for (const name of Object.keys(AGENT_DEFINITIONS)) {
    checks.push({
      group: "Agents",
      label: `agents/${name}.toml`,
      ok: existsSync(path.join(scopePaths.agentsDir, `${name}.toml`))
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
