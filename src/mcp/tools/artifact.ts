import path from "node:path";
import { writeFile } from "node:fs/promises";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { textResult } from "../../shared/mcp-utils.js";
import { createNexusPaths, ensureDir, findProjectRoot } from "../../shared/paths.js";

export function registerArtifactTools(server: McpServer): void {
  server.tool(
    "nx_artifact_write",
    "Write an artifact under .nexus/state/codex-nexus/artifacts",
    {
      filename: z.string(),
      content: z.string()
    },
    async ({ filename, content }) => {
      const paths = createNexusPaths(findProjectRoot());
      await ensureDir(paths.ARTIFACTS_ROOT);
      const outputPath = path.join(paths.ARTIFACTS_ROOT, filename);
      await writeFile(outputPath, content, "utf8");
      return textResult({ success: true, path: outputPath });
    }
  );
}
