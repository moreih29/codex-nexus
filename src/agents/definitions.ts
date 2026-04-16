export interface AgentDefinition {
  name: string;
  description: string;
  category: "how" | "do" | "check";
}

export const AGENT_DEFINITIONS: Record<string, AgentDefinition> = {
  architect: {
    name: "architect",
    description: "Technical design, interfaces, architectural trade-offs",
    category: "how"
  },
  designer: {
    name: "designer",
    description: "UX, UI, and interaction design review",
    category: "how"
  },
  postdoc: {
    name: "postdoc",
    description: "Research method design and evidence synthesis",
    category: "how"
  },
  strategist: {
    name: "strategist",
    description: "Product and business strategy guidance",
    category: "how"
  },
  engineer: {
    name: "engineer",
    description: "Code implementation, fixes, and debugging",
    category: "do"
  },
  researcher: {
    name: "researcher",
    description: "Independent investigation and evidence gathering",
    category: "do"
  },
  writer: {
    name: "writer",
    description: "Documentation and structured written deliverables",
    category: "do"
  },
  reviewer: {
    name: "reviewer",
    description: "Content and output review with fact and quality checks",
    category: "check"
  },
  tester: {
    name: "tester",
    description: "Testing, verification, and regression risk checks",
    category: "check"
  }
};

export const AGENT_MODEL_BY_CATEGORY: Record<AgentDefinition["category"], string> = {
  how: "gpt-5.4",
  do: "gpt-5.3-codex",
  check: "gpt-5.3-codex"
};
