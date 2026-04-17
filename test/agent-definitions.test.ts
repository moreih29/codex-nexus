import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import { AGENT_DEFINITIONS } from "../src/agents/definitions.js";
import { parseAgentPromptMetadata } from "../src/agents/prompt-metadata.js";

describe("agent definition metadata", () => {
  test("matches generated prompt frontmatter", async () => {
    for (const [name, definition] of Object.entries(AGENT_DEFINITIONS)) {
      const promptContent = await readFile(path.join(process.cwd(), "prompts", `${name}.md`), "utf8");

      expect(parseAgentPromptMetadata(promptContent)).toEqual({
        name: definition.name,
        description: definition.description,
        category: definition.category,
        resume_tier: definition.resumeTier
      });
    }
  });
});
