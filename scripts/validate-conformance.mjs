import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const coreRoot = path.join(repoRoot, "node_modules", "@moreih29", "nexus-core");
const localConformanceRoot = path.join(repoRoot, "conformance");

function runBun(args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd,
      env: process.env,
      stdio: "inherit"
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`bun ${args.join(" ")} exited with code ${code}`));
    });
  });
}

if (!existsSync(coreRoot)) {
  console.error(`Missing nexus-core package at ${coreRoot}`);
  process.exit(1);
}

await runBun(["run", "validate:conformance"], coreRoot);

if (existsSync(localConformanceRoot)) {
  await runBun([path.join(coreRoot, "scripts", "conformance-coverage.ts")], repoRoot);
} else {
  console.log("No local consumer conformance fixtures found; validated upstream nexus-core coverage only.");
}
