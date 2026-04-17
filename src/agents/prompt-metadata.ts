import type { AgentDefinition } from "./definitions.js";

export interface AgentPromptMetadata {
  name: string;
  description: string;
  category: AgentDefinition["category"];
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

function unquoteYamlScalar(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length < 2) return trimmed;

  const quote = trimmed[0];
  if ((quote !== '"' && quote !== "'") || trimmed.at(-1) !== quote) {
    return trimmed;
  }

  return trimmed.slice(1, -1).replace(/\\(["'\\])/g, "$1");
}

export function parseAgentPromptMetadata(content: string): Partial<AgentPromptMetadata> {
  const match = content.match(FRONTMATTER_RE);
  if (!match) return {};

  const metadata: Partial<AgentPromptMetadata> = {};

  for (const line of match[1].split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separatorIndex = trimmed.indexOf(":");
    if (separatorIndex === -1) continue;

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = unquoteYamlScalar(trimmed.slice(separatorIndex + 1));

    if (key === "name" && value.length > 0) {
      metadata.name = value;
    } else if (key === "description" && value.length > 0) {
      metadata.description = value;
    } else if (key === "category" && (value === "how" || value === "do" || value === "check")) {
      metadata.category = value;
    }
  }

  return metadata;
}
