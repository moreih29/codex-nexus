import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const corePackagePath = path.join(repoRoot, "node_modules", "@moreih29", "nexus-core", "package.json");

function ensureDir(dirPath) {
  mkdirSync(dirPath, { recursive: true });
}

function replaceDirectory(sourceDir, destinationDir) {
  rmSync(destinationDir, { recursive: true, force: true });
  ensureDir(path.dirname(destinationDir));
  cpSync(sourceDir, destinationDir, { recursive: true });
}

function replaceFile(sourcePath, destinationPath) {
  ensureDir(path.dirname(destinationPath));
  cpSync(sourcePath, destinationPath, { force: true });
}

if (!existsSync(corePackagePath)) {
  throw new Error(`Missing installed nexus-core package at ${corePackagePath}`);
}

const stagingRoot = mkdtempSync(path.join(tmpdir(), "codex-nexus-sync-"));
const targetRoot = path.join(stagingRoot, "out");
const nexusCoreBin = path.join(
  repoRoot,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "nexus-core.cmd" : "nexus-core"
);

try {
  const result = spawnSync(
    nexusCoreBin,
    ["sync", "--harness=codex", `--target=${targetRoot}`],
    {
      cwd: repoRoot,
      stdio: "inherit"
    }
  );

  if (result.status !== 0) {
    throw new Error(`nexus-core sync failed with exit code ${result.status ?? 1}`);
  }

  replaceDirectory(path.join(targetRoot, "agents"), path.join(repoRoot, "agents"));
  replaceDirectory(path.join(targetRoot, "plugin"), path.join(repoRoot, "plugin"));
  replaceDirectory(path.join(targetRoot, "prompts"), path.join(repoRoot, "prompts"));

  replaceFile(
    path.join(targetRoot, "install", "AGENTS.fragment.md"),
    path.join(repoRoot, "install", "AGENTS.fragment.md")
  );
  replaceFile(
    path.join(targetRoot, "install", "config.fragment.toml"),
    path.join(repoRoot, "install", "config.fragment.toml")
  );

  const wrapperPackage = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"));
  const pluginManifestPath = path.join(repoRoot, "plugin", ".codex-plugin", "plugin.json");
  const pluginManifest = JSON.parse(readFileSync(pluginManifestPath, "utf8"));
  pluginManifest.name = wrapperPackage.name;
  pluginManifest.version = wrapperPackage.version;
  pluginManifest.description = wrapperPackage.description;
  writeFileSync(pluginManifestPath, JSON.stringify(pluginManifest, null, 2) + "\n", "utf8");

  const corePackage = JSON.parse(readFileSync(corePackagePath, "utf8"));
  console.log(`Synced Codex managed outputs from @moreih29/nexus-core@${corePackage.version}.`);
} finally {
  rmSync(stagingRoot, { recursive: true, force: true });
}
