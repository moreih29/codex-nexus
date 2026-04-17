import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { expandPrimitive, loadInvocationMap } from "../scripts/generate-from-nexus-core.lib.mjs";

describe("generator invocation mapping", () => {
  test("maps task_register to Codex update_plan guidance", () => {
    const invocationMap = loadInvocationMap();

    const expanded = expandPrimitive(
      "task_register",
      {
        label: "Implement task register mapping",
        state: "in_progress"
      },
      invocationMap
    );

    expect(expanded).toContain("Codex visual progress tracker");
    expect(expanded).toContain("use update_plan");
    expect(expanded).toContain("existing plan items");
    expect(expanded).toContain('whose step is "Implement task register mapping"');
    expect(expanded).toContain('to status "in_progress"');
  });

  test("generated nx-run skill includes task_register tool guidance", () => {
    const skillPath = path.join(process.cwd(), "skills", "nx-run", "SKILL.md");
    const skill = readFileSync(skillPath, "utf8");

    expect(skill).toContain("use update_plan to keep the existing plan items in sync");
    expect(skill).toContain("Do not use nx_task_add or nx_task_update for this primitive");
  });
});
