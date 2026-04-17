import { getAgentResumeTier, type ResumeTier } from "../agents/definitions.js";
import type { AgentTrackerFile, AgentTrackerInvocation } from "./state.js";
import type { TaskRecord } from "./tasks.js";

export type TaskReusePolicy = "fresh" | "resume_if_same_artifact" | "resume";

export interface PlanIssueLike {
  id: number;
  title: string;
  status: string;
  how_agents?: string[];
  how_summary?: Record<string, string>;
  how_agent_ids?: Record<string, string>;
}

export interface PlanLike {
  id: number;
  topic: string;
  issues: PlanIssueLike[];
}

export interface PlanContinuity {
  role: string;
  resume_tier: ResumeTier;
  resumable: boolean;
  resume_agent_id: string | null;
  source: "plan_issue" | "tracker" | "none";
  issue_id: number | null;
  last_summary: string | null;
  tracker_status: "running" | "completed" | null;
  reason: string;
}

export interface RunTaskContinuity {
  task_id: number;
  owner: string | null;
  resume_tier: ResumeTier;
  reuse_policy: TaskReusePolicy;
  resumable: boolean;
  resume_agent_id: string | null;
  source: "task.owner_agent_id" | "tracker" | "none";
  last_summary: string | null;
  tracker_status: "running" | "completed" | null;
  requires_reread: boolean;
  reason: string;
}

function normalizeRole(role: string | null | undefined): string | null {
  if (typeof role !== "string") return null;
  const normalized = role.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function timestampOf(entry: AgentTrackerInvocation): string {
  return entry.last_resumed_at ?? entry.stopped_at ?? entry.started_at;
}

function compareLatest(a: AgentTrackerInvocation, b: AgentTrackerInvocation): number {
  return timestampOf(b).localeCompare(timestampOf(a));
}

export function isCompletedInvocation(entry: AgentTrackerInvocation): boolean {
  return entry.status === "completed" || Boolean(entry.stopped_at && entry.status !== "running");
}

export function getDefaultReusePolicy(resumeTier: ResumeTier): TaskReusePolicy {
  if (resumeTier === "persistent") return "resume";
  if (resumeTier === "bounded") return "resume_if_same_artifact";
  return "fresh";
}

export function findInvocationByAgentId(
  tracker: AgentTrackerFile,
  agentId: string | null | undefined
): AgentTrackerInvocation | null {
  if (!agentId) return null;
  return tracker.invocations.find((entry) => entry.agent_id === agentId) ?? null;
}

export function listInvocationsForRole(
  tracker: AgentTrackerFile,
  role: string | null | undefined
): AgentTrackerInvocation[] {
  const normalizedRole = normalizeRole(role);
  if (!normalizedRole) return [];
  return tracker.invocations
    .filter((entry) => normalizeRole(entry.agent_name) === normalizedRole)
    .sort(compareLatest);
}

export function latestCompletedInvocationForRole(
  tracker: AgentTrackerFile,
  role: string | null | undefined
): AgentTrackerInvocation | null {
  return listInvocationsForRole(tracker, role).find((entry) => isCompletedInvocation(entry) && !!entry.agent_id) ?? null;
}

function overlap(a: readonly string[] | undefined, b: readonly string[] | undefined): boolean {
  if (!a || !b || a.length === 0 || b.length === 0) return false;
  const set = new Set(a);
  return b.some((item) => set.has(item));
}

function hasInterveningOverlappingEdits(
  tracker: AgentTrackerFile,
  candidate: AgentTrackerInvocation
): boolean {
  if (!candidate.files_touched || candidate.files_touched.length === 0) return false;
  const candidateTimestamp = candidate.stopped_at ?? timestampOf(candidate);

  return tracker.invocations.some((entry) => {
    if (entry === candidate) return false;
    if (!entry.files_touched || entry.files_touched.length === 0) return false;
    if (!overlap(candidate.files_touched, entry.files_touched)) return false;
    return timestampOf(entry) > candidateTimestamp;
  });
}

function findPlanHandle(plan: PlanLike | null, role: string, issueId?: number): {
  issue: PlanIssueLike | null;
  agentId: string | null;
  summary: string | null;
} {
  if (!plan) {
    return { issue: null, agentId: null, summary: null };
  }

  const issues = issueId !== undefined
    ? plan.issues.filter((issue) => issue.id === issueId)
    : [
        ...plan.issues.filter((issue) => issue.status === "pending"),
        ...[...plan.issues].sort((a, b) => b.id - a.id)
      ];

  for (const issue of issues) {
    const agentId = issue.how_agent_ids?.[role] ?? null;
    if (!agentId) continue;
    return {
      issue,
      agentId,
      summary: issue.how_summary?.[role] ?? null
    };
  }

  return { issue: null, agentId: null, summary: null };
}

export function resolvePlanContinuity(options: {
  plan: PlanLike | null;
  tracker: AgentTrackerFile;
  role: string;
  issueId?: number;
}): PlanContinuity {
  const role = normalizeRole(options.role) ?? options.role;
  const resumeTier = getAgentResumeTier(role);

  if (resumeTier === "ephemeral") {
    return {
      role,
      resume_tier: resumeTier,
      resumable: false,
      resume_agent_id: null,
      source: "none",
      issue_id: null,
      last_summary: null,
      tracker_status: null,
      reason: `${role} is ephemeral and should always spawn fresh.`
    };
  }

  const planHandle = findPlanHandle(options.plan, role, options.issueId);
  if (planHandle.agentId) {
    const trackerEntry = findInvocationByAgentId(options.tracker, planHandle.agentId);
    if (trackerEntry?.status === "running") {
      return {
        role,
        resume_tier: resumeTier,
        resumable: false,
        resume_agent_id: planHandle.agentId,
        source: "plan_issue",
        issue_id: planHandle.issue?.id ?? null,
        last_summary: trackerEntry.last_message ?? planHandle.summary,
        tracker_status: trackerEntry.status ?? null,
        reason: `${role} already has an active running session. Resume guidance only applies after completion.`
      };
    }

    return {
      role,
      resume_tier: resumeTier,
      resumable: true,
      resume_agent_id: planHandle.agentId,
      source: "plan_issue",
      issue_id: planHandle.issue?.id ?? null,
      last_summary: trackerEntry?.last_message ?? planHandle.summary,
      tracker_status: trackerEntry?.status ?? null,
      reason: `Use the recorded ${role} participant from plan continuity.`
    };
  }

  const trackerEntry = latestCompletedInvocationForRole(options.tracker, role);
  if (trackerEntry?.agent_id) {
    return {
      role,
      resume_tier: resumeTier,
      resumable: true,
      resume_agent_id: trackerEntry.agent_id,
      source: "tracker",
      issue_id: null,
      last_summary: trackerEntry.last_message ?? null,
      tracker_status: trackerEntry.status ?? null,
      reason: `Use the most recent completed ${role} participant from agent-tracker continuity.`
    };
  }

  return {
    role,
    resume_tier: resumeTier,
    resumable: false,
    resume_agent_id: null,
    source: "none",
    issue_id: null,
    last_summary: null,
    tracker_status: null,
    reason: `No completed ${role} participant with a reusable Codex agent id was found.`
  };
}

export function resolveRunTaskContinuity(options: {
  task: TaskRecord;
  tracker: AgentTrackerFile;
}): RunTaskContinuity {
  const owner = normalizeRole(options.task.owner);
  const resumeTier = getAgentResumeTier(owner);
  const reusePolicy = options.task.owner_reuse_policy ?? getDefaultReusePolicy(resumeTier);

  if (!owner || owner === "lead") {
    return {
      task_id: options.task.id,
      owner,
      resume_tier: resumeTier,
      reuse_policy: reusePolicy,
      resumable: false,
      resume_agent_id: null,
      source: "none",
      last_summary: null,
      tracker_status: null,
      requires_reread: false,
      reason: "Task owner is lead or unset, so Codex subagent resume does not apply."
    };
  }

  if (resumeTier === "ephemeral" || reusePolicy === "fresh") {
    return {
      task_id: options.task.id,
      owner,
      resume_tier: resumeTier,
      reuse_policy: reusePolicy,
      resumable: false,
      resume_agent_id: null,
      source: "none",
      last_summary: null,
      tracker_status: null,
      requires_reread: false,
      reason: `${owner} uses ${reusePolicy} / ${resumeTier} semantics, so this task should spawn fresh.`
    };
  }

  const explicitAgentId = options.task.owner_agent_id?.trim() || null;
  if (explicitAgentId) {
    const trackerEntry = findInvocationByAgentId(options.tracker, explicitAgentId);
    if (trackerEntry?.status === "running") {
      return {
        task_id: options.task.id,
        owner,
        resume_tier: resumeTier,
        reuse_policy: reusePolicy,
        resumable: false,
        resume_agent_id: explicitAgentId,
        source: "task.owner_agent_id",
        last_summary: trackerEntry.last_message ?? null,
        tracker_status: trackerEntry.status ?? null,
        requires_reread: resumeTier === "bounded",
        reason: `${owner} is already running for this task; completed-agent resume is not applicable yet.`
      };
    }

    if (resumeTier === "bounded" && trackerEntry && hasInterveningOverlappingEdits(options.tracker, trackerEntry)) {
      return {
        task_id: options.task.id,
        owner,
        resume_tier: resumeTier,
        reuse_policy: reusePolicy,
        resumable: false,
        resume_agent_id: explicitAgentId,
        source: "task.owner_agent_id",
        last_summary: trackerEntry.last_message ?? null,
        tracker_status: trackerEntry.status ?? null,
        requires_reread: true,
        reason: `${owner} touched files that were later modified by another agent, so bounded resume is blocked.`
      };
    }

    return {
      task_id: options.task.id,
      owner,
      resume_tier: resumeTier,
      reuse_policy: reusePolicy,
      resumable: true,
      resume_agent_id: explicitAgentId,
      source: "task.owner_agent_id",
      last_summary: trackerEntry?.last_message ?? null,
      tracker_status: trackerEntry?.status ?? null,
      requires_reread: resumeTier === "bounded",
      reason: resumeTier === "bounded"
        ? `Resume the task's pinned ${owner} agent id and require a target-file re-read before modification.`
        : `Resume the task's pinned ${owner} agent id.`
    };
  }

  if (resumeTier === "bounded") {
    return {
      task_id: options.task.id,
      owner,
      resume_tier: resumeTier,
      reuse_policy: reusePolicy,
      resumable: false,
      resume_agent_id: null,
      source: "none",
      last_summary: null,
      tracker_status: null,
      requires_reread: true,
      reason: `Bounded resume requires owner_agent_id to be persisted on the task after the first spawn.`
    };
  }

  const trackerEntry = latestCompletedInvocationForRole(options.tracker, owner);
  if (trackerEntry?.agent_id) {
    return {
      task_id: options.task.id,
      owner,
      resume_tier: resumeTier,
      reuse_policy: reusePolicy,
      resumable: true,
      resume_agent_id: trackerEntry.agent_id,
      source: "tracker",
      last_summary: trackerEntry.last_message ?? null,
      tracker_status: trackerEntry.status ?? null,
      requires_reread: false,
      reason: `Resume the most recent completed ${owner} participant for this run.`
    };
  }

  return {
    task_id: options.task.id,
    owner,
    resume_tier: resumeTier,
    reuse_policy: reusePolicy,
    resumable: false,
    resume_agent_id: null,
    source: "none",
    last_summary: null,
    tracker_status: null,
    requires_reread: false,
    reason: `No completed ${owner} participant with a reusable Codex agent id was found.`
  };
}
