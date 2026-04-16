import { existsSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { ensureDir, ensureFile, type NexusPaths } from "./paths.js";

export interface AgentTrackerInvocation {
  agent_name: string;
  agent_id?: string;
  task_id?: string;
  session_id?: string;
  parent_session_id?: string;
  status?: string;
  last_summary?: string;
  files_touched?: string[];
  agent_nickname?: string;
  agent_path?: string | null;
  transcript_path?: string | null;
  source?: string;
  updated_at?: string;
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
  if (Array.isArray(data)) {
    return { invocations: data as AgentTrackerInvocation[] };
  }
  if (
    data &&
    typeof data === "object" &&
    "invocations" in data &&
    Array.isArray((data as { invocations?: unknown }).invocations)
  ) {
    return { invocations: (data as { invocations: AgentTrackerInvocation[] }).invocations };
  }
  return { invocations: [] };
}

export async function upsertAgentTrackerEntry(
  filePath: string,
  entry: AgentTrackerInvocation
): Promise<void> {
  const tracker = await readAgentTracker(filePath);
  const existing = tracker.invocations.find(
    (item) =>
      (entry.session_id && item.session_id === entry.session_id) ||
      (entry.agent_id && item.agent_id === entry.agent_id) ||
      (item.agent_name === entry.agent_name && item.agent_id === entry.agent_id)
  );

  if (existing) {
    Object.assign(existing, entry, { updated_at: new Date().toISOString() });
  } else {
    tracker.invocations.push({
      ...entry,
      updated_at: new Date().toISOString()
    });
  }

  await writeJsonFile(filePath, tracker.invocations);
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
}

export async function removeAgentTracker(filePath: string): Promise<void> {
  if (!existsSync(filePath)) return;
  await rm(filePath, { force: true });
}
