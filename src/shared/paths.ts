import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const HARNESS_ID = "codex-nexus";
export const AGENTS_MARKER_START = "<!-- CODEX-NEXUS:START -->";
export const AGENTS_MARKER_END = "<!-- CODEX-NEXUS:END -->";

export type SetupScope = "user" | "project";

export interface ScopePaths {
  scope: SetupScope;
  projectRoot: string;
  codexHomeDir: string;
  packageStoreDir: string;
  configTomlPath: string;
  hooksJsonPath: string;
  skillsDir: string;
  agentsDir: string;
  agentsMdPath: string;
}

export interface NexusPaths {
  PROJECT_ROOT: string;
  NEXUS_ROOT: string;
  CONTEXT_ROOT: string;
  MEMORY_ROOT: string;
  RULES_ROOT: string;
  STATE_ROOT: string;
  HARNESS_STATE_ROOT: string;
  HISTORY_FILE: string;
  PLAN_FILE: string;
  TASKS_FILE: string;
  AGENT_TRACKER_FILE: string;
  TOOL_LOG_FILE: string;
  ARTIFACTS_ROOT: string;
}

export function findProjectRoot(startDir = process.cwd()): string {
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

export function packageRoot(): string {
  return path.resolve(import.meta.dirname, "..", "..");
}

export function resolveScopePaths(scope: SetupScope, cwd = process.cwd()): ScopePaths {
  const projectRoot = findProjectRoot(cwd);
  const codexHomeDir = scope === "project"
    ? path.join(projectRoot, ".codex")
    : path.join(process.env.CODEX_HOME ?? path.join(process.env.HOME ?? "~", ".codex"));
  const packageStoreDir = path.join(codexHomeDir, "packages");

  return {
    scope,
    projectRoot,
    codexHomeDir,
    packageStoreDir,
    configTomlPath: path.join(codexHomeDir, "config.toml"),
    hooksJsonPath: path.join(codexHomeDir, "hooks.json"),
    skillsDir: path.join(codexHomeDir, "skills"),
    agentsDir: path.join(codexHomeDir, "agents"),
    agentsMdPath: path.join(projectRoot, "AGENTS.md")
  };
}

export function createNexusPaths(projectRoot: string): NexusPaths {
  const NEXUS_ROOT = path.join(projectRoot, ".nexus");
  const CONTEXT_ROOT = path.join(NEXUS_ROOT, "context");
  const MEMORY_ROOT = path.join(NEXUS_ROOT, "memory");
  const RULES_ROOT = path.join(NEXUS_ROOT, "rules");
  const STATE_ROOT = path.join(NEXUS_ROOT, "state");
  const HARNESS_STATE_ROOT = path.join(STATE_ROOT, HARNESS_ID);

  return {
    PROJECT_ROOT: projectRoot,
    NEXUS_ROOT,
    CONTEXT_ROOT,
    MEMORY_ROOT,
    RULES_ROOT,
    STATE_ROOT,
    HARNESS_STATE_ROOT,
    HISTORY_FILE: path.join(NEXUS_ROOT, "history.json"),
    PLAN_FILE: path.join(STATE_ROOT, "plan.json"),
    TASKS_FILE: path.join(STATE_ROOT, "tasks.json"),
    AGENT_TRACKER_FILE: path.join(HARNESS_STATE_ROOT, "agent-tracker.json"),
    TOOL_LOG_FILE: path.join(HARNESS_STATE_ROOT, "tool-log.jsonl"),
    ARTIFACTS_ROOT: path.join(HARNESS_STATE_ROOT, "artifacts")
  };
}

export async function ensureDir(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true });
}

export async function ensureFile(filePath: string, content: string): Promise<void> {
  if (existsSync(filePath)) return;
  await ensureDir(path.dirname(filePath));
  await writeFile(filePath, content, "utf8");
}

export async function readTextIfExists(filePath: string): Promise<string | null> {
  if (!existsSync(filePath)) return null;
  return readFile(filePath, "utf8");
}

export async function writeText(filePath: string, content: string): Promise<void> {
  await ensureDir(path.dirname(filePath));
  await writeFile(filePath, content, "utf8");
}

export async function ensureProjectGitignore(projectRoot: string): Promise<void> {
  const gitignorePath = path.join(projectRoot, ".gitignore");
  const requiredLines = [
    ".nexus/state/",
    ".codex/config.toml",
    ".codex/hooks.json",
    ".codex/packages/"
  ];
  const existing = (await readTextIfExists(gitignorePath)) ?? "";
  const lines = new Set(existing.split(/\r?\n/).filter(Boolean));
  let changed = false;
  for (const line of requiredLines) {
    if (!lines.has(line)) {
      lines.add(line);
      changed = true;
    }
  }
  if (changed || !existsSync(gitignorePath)) {
    const next = `${Array.from(lines).join("\n")}\n`;
    await writeText(gitignorePath, next);
  }
}
