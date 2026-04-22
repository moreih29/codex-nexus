import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import TOML from "@iarna/toml";

function safeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

export function managedNxServerConfig(nexusCoreVersion) {
  return {
    command: "npx",
    args: ["-y", "-p", `@moreih29/nexus-core@${nexusCoreVersion}`, "nexus-mcp"]
  };
}

export function managedInstalledNxServerConfig(runtimeCommand, serverPath) {
  return {
    command: runtimeCommand,
    args: [serverPath]
  };
}

function buildNxServerBlock(nxServerConfig, disabledTools) {
  const payload = {
    mcp_servers: {
      nx: {
        ...safeObject(nxServerConfig),
        ...(Array.isArray(disabledTools) ? { disabled_tools: disabledTools } : {})
      }
    }
  };

  return TOML.stringify(payload).trimEnd() + "\n";
}

function replaceNxServerBlock(agentTomlContent, nextBlock) {
  const marker = "[mcp_servers.nx]";
  const markerIndex = agentTomlContent.indexOf(marker);
  if (markerIndex === -1) {
    return agentTomlContent;
  }

  const prefix = agentTomlContent.slice(0, markerIndex).replace(/\s*$/, "\n\n");
  return `${prefix}${nextBlock}`;
}

export function readAgentNxServerConfigs(agentDir) {
  if (!existsSync(agentDir)) {
    return [];
  }

  return readdirSync(agentDir)
    .filter((entry) => entry.endsWith(".toml"))
    .map((entry) => {
      const filePath = path.join(agentDir, entry);
      const content = readFileSync(filePath, "utf8");
      const parsed = TOML.parse(content);
      const nxConfig = safeObject(safeObject(parsed.mcp_servers).nx);

      return {
        file: entry,
        filePath,
        hasNxServer: Object.keys(nxConfig).length > 0,
        command: typeof nxConfig.command === "string" ? nxConfig.command : "",
        args: Array.isArray(nxConfig.args) ? nxConfig.args : [],
        disabledTools: Array.isArray(nxConfig.disabled_tools) ? nxConfig.disabled_tools : []
      };
    })
    .filter((entry) => entry.hasNxServer);
}

export function normalizeAgentNxServerBlocks(agentDir, nxServerConfig) {
  const changed = [];
  for (const current of readAgentNxServerConfigs(agentDir)) {
    const content = readFileSync(current.filePath, "utf8");
    const nextBlock = buildNxServerBlock(nxServerConfig, current.disabledTools);
    const nextContent = replaceNxServerBlock(content, nextBlock);

    if (nextContent !== content) {
      writeFileSync(current.filePath, nextContent, "utf8");
      changed.push(current.filePath);
    }
  }

  return changed;
}
