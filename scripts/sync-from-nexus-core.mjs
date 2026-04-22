import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { managedNxServerConfig, normalizeAgentNxServerBlocks } from "./lib/nx-agent-mcp.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..");
const packageJsonPath = path.join(repoRoot, "package.json");
const pluginRoot = path.join(repoRoot, "plugins", "codex-nexus");
const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
const nexusCoreVersion = packageJson.dependencies?.["@moreih29/nexus-core"];
const nexusCoreSpecLeadPath = path.join(
  repoRoot,
  "node_modules",
  "@moreih29",
  "nexus-core",
  "spec",
  "agents",
  "lead",
  "body.md"
);

if (!nexusCoreVersion) {
  throw new Error("Missing @moreih29/nexus-core in devDependencies.");
}

const nexusSyncBin = path.join(
  repoRoot,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "nexus-sync.cmd" : "nexus-sync"
);

if (!existsSync(nexusSyncBin)) {
  throw new Error(`Missing nexus-sync binary at ${nexusSyncBin}. Run 'bun install' first.`);
}

function replaceDirectory(sourceDir, destinationDir) {
  rmSync(destinationDir, { recursive: true, force: true });
  mkdirSync(path.dirname(destinationDir), { recursive: true });
  cpSync(sourceDir, destinationDir, { recursive: true });
}

function stripFrontmatter(markdown) {
  return markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
}

function writeFile(destinationPath, content) {
  mkdirSync(path.dirname(destinationPath), { recursive: true });
  writeFileSync(destinationPath, content, "utf8");
}

function writeLeadInstructions() {
  const leadSpec = readFileSync(nexusCoreSpecLeadPath, "utf8");
  const leadInstructions = stripFrontmatter(leadSpec).trim() + "\n";

  writeFile(path.join(pluginRoot, "lead.instructions.md"), leadInstructions);
}

const stagingRoot = mkdtempSync(path.join(tmpdir(), "codex-nexus-sync-"));

try {
  const result = spawnSync(nexusSyncBin, ["--harness=codex", `--target=${stagingRoot}`], {
    cwd: repoRoot,
    stdio: "inherit"
  });

  if (result.status !== 0) {
    throw new Error(`nexus-sync failed with exit code ${result.status ?? 1}.`);
  }

  replaceDirectory(path.join(stagingRoot, ".codex", "skills"), path.join(pluginRoot, "skills"));
  replaceDirectory(path.join(stagingRoot, ".codex", "agents"), path.join(pluginRoot, "agents"));
  normalizeAgentNxServerBlocks(path.join(pluginRoot, "agents"), managedNxServerConfig(nexusCoreVersion));
  writeLeadInstructions();

  console.log(`Synced Codex artifacts from @moreih29/nexus-core@${nexusCoreVersion}.`);
} finally {
  rmSync(stagingRoot, { recursive: true, force: true });
}
