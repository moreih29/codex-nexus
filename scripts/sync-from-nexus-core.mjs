import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import TOML from "@iarna/toml";

const repoRoot = path.resolve(import.meta.dirname, "..");
const packageJsonPath = path.join(repoRoot, "package.json");
const pluginRoot = path.join(repoRoot, "plugins", "codex-nexus");
const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
const nexusCoreVersion = packageJson.dependencies?.["@moreih29/nexus-core"];
const downstreamManagedAgentFiles = [
  "architect.toml",
  "designer.toml",
  "engineer.toml",
  "postdoc.toml",
  "researcher.toml",
  "reviewer.toml",
  "strategist.toml",
  "tester.toml",
  "writer.toml"
];
const generatedAgentFiles = ["lead.toml", ...downstreamManagedAgentFiles];
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

function ensureBareNxLauncherInPublishableAgent(agentPath) {
  const current = readFileSync(agentPath, "utf8");
  if (current.includes('[mcp_servers.nx]\ncommand = "nexus-mcp"\n')) {
    return;
  }

  const next = current.replace("[mcp_servers.nx]\n", '[mcp_servers.nx]\ncommand = "nexus-mcp"\n');
  if (next === current) {
    throw new Error(`Unable to patch [mcp_servers.nx] block for ${agentPath}`);
  }
  writeFile(agentPath, next);
}

function toggleMultilineTomlState(line, currentDelimiter) {
  if (currentDelimiter) {
    return line.includes(currentDelimiter) ? null : currentDelimiter;
  }

  const doubleIndex = line.indexOf('"""');
  const singleIndex = line.indexOf("'''");
  if (doubleIndex === -1 && singleIndex === -1) {
    return null;
  }
  if (doubleIndex !== -1 && (singleIndex === -1 || doubleIndex < singleIndex)) {
    return line.indexOf('"""', doubleIndex + 3) === -1 ? '"""' : null;
  }
  return line.indexOf("'''", singleIndex + 3) === -1 ? "'''" : null;
}

function stripTopLevelModelFromPublishableAgent(agentPath) {
  const current = readFileSync(agentPath, "utf8");
  const parsed = TOML.parse(current);
  if (!Object.prototype.hasOwnProperty.call(parsed, "model")) {
    return;
  }

  const lines = current.replace(/\r\n/g, "\n").split("\n");
  const hadTrailingNewline = lines.at(-1) === "";
  if (hadTrailingNewline) {
    lines.pop();
  }

  let multilineDelimiter = null;
  let removed = false;
  const nextLines = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!multilineDelimiter && /^\s*\[\[?[^\]]+\]\]?\s*(?:#.*)?$/.test(line)) {
      nextLines.push(line);
      nextLines.push(...lines.slice(index + 1));
      break;
    }

    if (!multilineDelimiter && /^\s*model\s*=/.test(line)) {
      removed = true;
      continue;
    }

    nextLines.push(line);
    multilineDelimiter = toggleMultilineTomlState(line, multilineDelimiter);
  }

  if (!removed) {
    throw new Error(`Unable to locate top-level model field for ${agentPath}`);
  }

  const next = `${nextLines.join("\n")}${hadTrailingNewline ? "\n" : ""}`;
  const nextParsed = TOML.parse(next);
  if (Object.prototype.hasOwnProperty.call(nextParsed, "model")) {
    throw new Error(`Unable to strip top-level model field for ${agentPath}`);
  }

  writeFile(agentPath, next);
}

function applyDownstreamAgentLauncherCompatibilityFix(agentDir) {
  for (const agentFile of downstreamManagedAgentFiles) {
    const agentPath = path.join(agentDir, agentFile);
    if (!existsSync(agentPath)) {
      continue;
    }
    ensureBareNxLauncherInPublishableAgent(agentPath);
  }
}

function stripDefaultModelsFromPublishableAgents(agentDir) {
  for (const agentFile of generatedAgentFiles) {
    const agentPath = path.join(agentDir, agentFile);
    if (!existsSync(agentPath)) {
      continue;
    }
    stripTopLevelModelFromPublishableAgent(agentPath);
  }
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
  applyDownstreamAgentLauncherCompatibilityFix(path.join(pluginRoot, "agents"));
  stripDefaultModelsFromPublishableAgents(path.join(pluginRoot, "agents"));
  writeLeadInstructions();

  console.log(`Synced Codex artifacts from @moreih29/nexus-core@${nexusCoreVersion}.`);
} finally {
  rmSync(stagingRoot, { recursive: true, force: true });
}
