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
    description: "Technical design, interfaces, architectural trade-offs",
    category: "how",
    capabilities: ["no_file_edit", "no_task_create", "no_task_update"]
  },
  designer: {
    name: "designer",
    description: "UX, UI, and interaction design review",
    category: "how",
    capabilities: ["no_file_edit", "no_task_create", "no_task_update"]
  },
  postdoc: {
    name: "postdoc",
    description: "Research method design and evidence synthesis",
    category: "how",
    capabilities: ["no_file_edit", "no_task_create", "no_task_update"]
  },
  strategist: {
    name: "strategist",
    description: "Product and business strategy guidance",
    category: "how",
    capabilities: ["no_file_edit", "no_task_create", "no_task_update"]
  },
  engineer: {
    name: "engineer",
    description: "Code implementation, fixes, and debugging",
    category: "do",
    capabilities: ["no_task_create"]
  },
  researcher: {
    name: "researcher",
    description: "Independent investigation and evidence gathering",
    category: "do",
    capabilities: ["no_file_edit", "no_task_create"]
  },
  writer: {
    name: "writer",
    description: "Documentation and structured written deliverables",
    category: "do",
    capabilities: ["no_task_create"]
  },
  reviewer: {
    name: "reviewer",
    description: "Content and output review with fact and quality checks",
    category: "check",
    capabilities: ["no_file_edit", "no_task_create"]
  },
  tester: {
    name: "tester",
    description: "Testing, verification, and regression risk checks",
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
