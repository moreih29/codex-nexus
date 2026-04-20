import path from "node:path";

export function nexusCorePackageRoot(packageRoot: string): string {
  return path.join(packageRoot, "node_modules", "@moreih29", "nexus-core");
}

export function nexusCoreMcpServerPath(packageRoot: string): string {
  return path.join(nexusCorePackageRoot(packageRoot), "dist", "src", "mcp", "server.js");
}

export function nexusCoreCodexHookManifestPath(packageRoot: string): string {
  return path.join(nexusCorePackageRoot(packageRoot), "dist", "codex", "hooks", "hooks.json");
}

export function nexusCoreCodexHookRuntimePath(packageRoot: string, fileName: string): string {
  return path.join(nexusCorePackageRoot(packageRoot), "dist", "codex", "dist", "hooks", fileName);
}
