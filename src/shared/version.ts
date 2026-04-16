import { readFileSync } from "node:fs";
import path from "node:path";

export function getCurrentVersion(): string {
  const root = path.resolve(import.meta.dirname, "..", "..");
  return readFileSync(path.join(root, "VERSION"), "utf8").trim();
}
