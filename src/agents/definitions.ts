export type AgentCapability = "no_file_edit" | "no_task_create" | "no_task_update";

export interface AgentDefinition {
  name: string;
  description: string;
  category: "how" | "do" | "check";
  capabilities: readonly AgentCapability[];
}

export const AGENT_DEFINITIONS: Record<string, AgentDefinition> = {
  architect: {
    name: "architect",
    description: "Technical design — evaluates How, reviews architecture, advises on implementation approach",
    category: "how",
    capabilities: ["no_file_edit", "no_task_create", "no_task_update"]
  },
  designer: {
    name: "designer",
    description: "UX/UI design — evaluates user experience, interaction patterns, and how users will experience the product",
    category: "how",
    capabilities: ["no_file_edit", "no_task_create", "no_task_update"]
  },
  postdoc: {
    name: "postdoc",
    description: "Research methodology and synthesis — designs investigation approach, evaluates evidence quality, writes synthesis documents",
    category: "how",
    capabilities: ["no_file_edit", "no_task_create", "no_task_update"]
  },
  strategist: {
    name: "strategist",
    description: "Business strategy — evaluates market positioning, competitive landscape, and business viability of decisions",
    category: "how",
    capabilities: ["no_file_edit", "no_task_create", "no_task_update"]
  },
  engineer: {
    name: "engineer",
    description: "Implementation — writes code, debugs issues, follows specifications from Lead and architect",
    category: "do",
    capabilities: ["no_task_create"]
  },
  researcher: {
    name: "researcher",
    description: "Independent investigation — conducts web searches, gathers evidence, and reports findings with citations",
    category: "do",
    capabilities: ["no_file_edit", "no_task_create"]
  },
  writer: {
    name: "writer",
    description: "Technical writing — transforms research findings, code, and analysis into clear documents and presentations for the intended audience",
    category: "do",
    capabilities: ["no_task_create"]
  },
  reviewer: {
    name: "reviewer",
    description: "Content verification — validates accuracy, checks facts, confirms grammar and format of non-code deliverables",
    category: "check",
    capabilities: ["no_file_edit", "no_task_create"]
  },
  tester: {
    name: "tester",
    description: "Testing and verification — tests, verifies, validates stability and security of implementations",
    category: "check",
    capabilities: ["no_file_edit", "no_task_create"]
  }
};

export const AGENT_MODEL_BY_CATEGORY: Record<AgentDefinition["category"], string> = {
  how: "gpt-5.4",
  do: "gpt-5.3-codex",
  check: "gpt-5.3-codex"
};

export function agentHasCapability(
  agentName: string | null | undefined,
  capability: AgentCapability
): boolean {
  if (!agentName) return false;
  const definition = AGENT_DEFINITIONS[agentName];
  return definition?.capabilities.includes(capability) ?? false;
}
