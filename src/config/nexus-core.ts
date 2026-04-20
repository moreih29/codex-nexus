import { existsSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

function normalizePath(targetPath: string): string {
  try {
    return realpathSync(targetPath);
  } catch {
    return path.resolve(targetPath);
  }
}

export function nexusCorePackageRoot(packageRoot: string): string {
  try {
    const requireFromPackage = createRequire(path.join(packageRoot, "package.json"));
    return normalizePath(path.dirname(requireFromPackage.resolve("@moreih29/nexus-core/package.json")));
  } catch {
    const siblingRoot = path.join(packageRoot, "..", "@moreih29", "nexus-core");
    if (existsSync(path.join(siblingRoot, "package.json"))) {
      return normalizePath(siblingRoot);
    }

    const nestedRoot = path.join(packageRoot, "node_modules", "@moreih29", "nexus-core");
    if (existsSync(path.join(nestedRoot, "package.json"))) {
      return normalizePath(nestedRoot);
    }

    return normalizePath(nestedRoot);
  }
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
