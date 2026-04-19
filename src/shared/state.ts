import { existsSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { HARNESS_ID, ensureDir, ensureFile, type NexusPaths } from "./paths.js";

export interface AgentTrackerInvocation {
  harness_id: string;
  started_at: string;
  agent_name?: string;
  agent_id?: string;
  last_resumed_at?: string;
  resume_count?: number;
  status?: "running" | "completed";
  stopped_at?: string;
  last_message?: string;
  files_touched?: string[];
}

export interface AgentTrackerFile {
  invocations: AgentTrackerInvocation[];
}

export interface ToolLogEntry {
  ts: string;
  tool_name: string;
  path: string;
  session_id?: string;
  call_id?: string;
  status?: string;
}

function safeString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function safePatternString(value: unknown, pattern: RegExp): string | undefined {
  const text = safeString(value);
  return text && pattern.test(text) ? text : undefined;
}

function safeDateString(value: unknown): string | undefined {
  const text = safeString(value);
  if (!text) return undefined;
  return Number.isNaN(Date.parse(text)) ? undefined : text;
}

function safeStatus(value: unknown): "running" | "completed" | undefined {
  return value === "running" || value === "completed" ? value : undefined;
}

function normalizeAgentTrackerEntry(value: unknown): AgentTrackerInvocation | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const now = new Date().toISOString();

  const normalized: AgentTrackerInvocation = {
    harness_id: safePatternString(raw.harness_id, /^[a-z][a-z0-9-]*$/) ?? HARNESS_ID,
    started_at: safeDateString(raw.started_at) ?? now
  };

  const agentName = safePatternString(raw.agent_name, /^[a-z][a-z0-9-]*$/);
  if (agentName) normalized.agent_name = agentName;

  const agentId = safeString(raw.agent_id);
  if (agentId) normalized.agent_id = agentId;

  const lastResumedAt = safeDateString(raw.last_resumed_at);
  if (lastResumedAt) normalized.last_resumed_at = lastResumedAt;

  if (typeof raw.resume_count === "number" && Number.isFinite(raw.resume_count) && raw.resume_count >= 0) {
    normalized.resume_count = raw.resume_count;
  }

  const status = safeStatus(raw.status);
  if (status) normalized.status = status;

  const stoppedAt = safeDateString(raw.stopped_at);
  if (stoppedAt) normalized.stopped_at = stoppedAt;

  const lastMessage = safeString(raw.last_message);
  if (lastMessage) normalized.last_message = lastMessage;

  if (Array.isArray(raw.files_touched)) {
    const touched = raw.files_touched
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
    if (touched.length > 0) {
      normalized.files_touched = Array.from(new Set(touched));
    }
  }

  return normalized;
}

export async function ensureNexusStructure(paths: NexusPaths): Promise<void> {
  await Promise.all([
    ensureDir(paths.NEXUS_ROOT),
    ensureDir(paths.CONTEXT_ROOT),
    ensureDir(paths.MEMORY_ROOT),
    ensureDir(paths.RULES_ROOT),
    ensureDir(paths.STATE_ROOT),
    ensureDir(paths.HARNESS_STATE_ROOT),
    ensureDir(paths.ARTIFACTS_ROOT)
  ]);

  await ensureFile(paths.HISTORY_FILE, JSON.stringify({ cycles: [] }, null, 2) + "\n");
}

export async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  if (!existsSync(filePath)) return fallback;
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw) as T;
}

export async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await ensureDir(path.dirname(filePath));
  await writeFile(filePath, JSON.stringify(value, null, 2) + "\n", "utf8");
}

export async function readAgentTracker(filePath: string): Promise<AgentTrackerFile> {
  const data = await readJsonFile<unknown>(filePath, []);
  const rawEntries = Array.isArray(data)
    ? data
    : (
      data &&
      typeof data === "object" &&
      "invocations" in data &&
      Array.isArray((data as { invocations?: unknown }).invocations)
    )
      ? (data as { invocations: unknown[] }).invocations
      : [];

  return {
    invocations: rawEntries.flatMap((entry) => {
      const normalized = normalizeAgentTrackerEntry(entry);
      return normalized ? [normalized] : [];
    })
  };
}

export async function upsertAgentTrackerEntry(
  filePath: string,
  entry: AgentTrackerInvocation
): Promise<void> {
  const now = new Date().toISOString();
  const normalizedEntry = normalizeAgentTrackerEntry(entry) ?? {
    harness_id: HARNESS_ID,
    started_at: now
  };
  const tracker = await readAgentTracker(filePath);
  const existing = normalizedEntry.agent_id
    ? tracker.invocations.find((item) => item.agent_id === normalizedEntry.agent_id)
    : tracker.invocations.find(
        (item) =>
          normalizedEntry.harness_id === item.harness_id &&
          normalizedEntry.agent_name &&
          item.agent_name === normalizedEntry.agent_name &&
          !item.agent_id
      );

  if (existing) {
    const wasCompleted = existing.status === "completed";
    Object.assign(existing, normalizedEntry);
    existing.harness_id = normalizedEntry.harness_id || existing.harness_id || HARNESS_ID;
    existing.started_at = existing.started_at || normalizedEntry.started_at || now;
    if (normalizedEntry.status === "running") {
      if (wasCompleted) {
        existing.last_resumed_at = now;
        existing.resume_count = (existing.resume_count ?? 0) + 1;
      }
      delete existing.stopped_at;
    } else if (normalizedEntry.status === "completed") {
      existing.stopped_at = normalizedEntry.stopped_at ?? now;
    }
    if (normalizedEntry.files_touched) {
      existing.files_touched = Array.from(new Set(normalizedEntry.files_touched));
    }
  } else {
    const created: AgentTrackerInvocation = {
      ...normalizedEntry,
      harness_id: normalizedEntry.harness_id ?? HARNESS_ID,
      started_at: normalizedEntry.started_at ?? now
    };
    if (created.status === "completed" && !created.stopped_at) {
      created.stopped_at = now;
    }
    tracker.invocations.push(created);
  }

  await writeJsonFile(
    filePath,
    tracker.invocations.flatMap((item) => {
      const normalized = normalizeAgentTrackerEntry(item);
      return normalized ? [normalized] : [];
    })
  );
}

function isToolLogEntry(value: unknown): value is ToolLogEntry {
  return Boolean(
    value &&
    typeof value === "object" &&
    typeof (value as ToolLogEntry).ts === "string" &&
    typeof (value as ToolLogEntry).tool_name === "string" &&
    typeof (value as ToolLogEntry).path === "string"
  );
}

function toolLogEntryKey(entry: ToolLogEntry): string {
  return [
    entry.session_id ?? "",
    entry.call_id ?? "",
    entry.tool_name,
    entry.path,
    entry.status ?? ""
  ].join("\u0000");
}

export async function readToolLog(filePath: string): Promise<ToolLogEntry[]> {
  if (!existsSync(filePath)) return [];
  const raw = await readFile(filePath, "utf8");
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .flatMap((line) => {
      try {
        const parsed = JSON.parse(line) as unknown;
        return isToolLogEntry(parsed) ? [parsed] : [];
      } catch {
        return [];
      }
    });
}

export async function appendToolLogEntries(filePath: string, entries: ToolLogEntry[]): Promise<void> {
  if (entries.length === 0) return;

  const existingKeys = new Set((await readToolLog(filePath)).map(toolLogEntryKey));
  const pending = entries.filter((entry) => !existingKeys.has(toolLogEntryKey(entry)));
  if (pending.length === 0) return;

  await ensureDir(path.dirname(filePath));
  const lines = pending.map((entry) => JSON.stringify(entry)).join("\n");
  await writeFile(filePath, `${lines}\n`, { encoding: "utf8", flag: "a" });
}

export async function collectFilesTouchedFromToolLog(filePath: string, sessionId: string): Promise<string[]> {
  const entries = await readToolLog(filePath);
  return Array.from(
    new Set(
      entries
        .filter((entry) => entry.session_id === sessionId)
        .map((entry) => entry.path)
    )
  );
}

export async function resetSessionScopedState(paths: NexusPaths): Promise<void> {
  await writeJsonFile(paths.AGENT_TRACKER_FILE, []);
  await ensureDir(path.dirname(paths.TOOL_LOG_FILE));
  await writeFile(paths.TOOL_LOG_FILE, "", "utf8");
  await clearRunSessionMarker(paths.RUN_SESSION_FILE);
}

export async function removeAgentTracker(filePath: string): Promise<void> {
  if (!existsSync(filePath)) return;
  await rm(filePath, { force: true });
}

export async function markRunSessionActive(filePath: string): Promise<void> {
  await ensureDir(path.dirname(filePath));
  await writeFile(
    filePath,
    JSON.stringify({ active: true, updated_at: new Date().toISOString() }, null, 2) + "\n",
    "utf8"
  );
}

export function hasRunSessionMarker(filePath: string): boolean {
  return existsSync(filePath);
}

export async function clearRunSessionMarker(filePath: string): Promise<void> {
  if (!existsSync(filePath)) return;
  await rm(filePath, { force: true });
}
