import { rm } from "node:fs/promises";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const distRoot = path.join(repoRoot, "dist");

await import(path.join(repoRoot, "scripts", "sync-from-nexus-core.mjs"));
await rm(distRoot, { recursive: true, force: true });

const result = await Bun.build({
  entrypoints: [
    path.join(repoRoot, "src", "index.ts"),
    path.join(repoRoot, "src", "cli", "index.ts")
  ],
  outdir: distRoot,
  target: "bun",
  format: "esm",
  sourcemap: "external",
  splitting: false,
  minify: false
});

if (!result.success) {
  for (const log of result.logs) {
    console.error(log);
  }
  process.exitCode = 1;
  throw new Error("Build failed");
}

console.log("Build complete");
