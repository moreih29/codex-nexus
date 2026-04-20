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
  const agentsMdPath = scope === "project"
    ? path.join(projectRoot, "AGENTS.md")
    : path.join(codexHomeDir, "AGENTS.md");

  return {
    scope,
    projectRoot,
    codexHomeDir,
    packageStoreDir,
    configTomlPath: path.join(codexHomeDir, "config.toml"),
    hooksJsonPath: path.join(codexHomeDir, "hooks.json"),
    skillsDir: path.join(codexHomeDir, "skills"),
    agentsDir: path.join(codexHomeDir, "agents"),
    agentsMdPath
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
