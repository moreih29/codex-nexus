import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { ensureDir, ensureFile, type NexusPaths } from "./paths.js";

export interface AgentTrackerInvocation {
  agent_name: string;
  agent_id?: string;
  task_id?: string;
  session_id?: string;
  status?: string;
  last_summary?: string;
  files_touched?: string[];
  updated_at?: string;
}

export interface AgentTrackerFile {
  harness_id: string;
  started_at: string;
  invocations: AgentTrackerInvocation[];
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
  await ensureFile(
    paths.AGENT_TRACKER_FILE,
    JSON.stringify(
      {
        harness_id: "codex-nexus",
        started_at: new Date().toISOString(),
        invocations: []
      },
      null,
      2
    ) + "\n"
  );
  await ensureFile(paths.TOOL_LOG_FILE, "");
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
  return readJsonFile<AgentTrackerFile>(filePath, {
    harness_id: "codex-nexus",
    started_at: new Date().toISOString(),
    invocations: []
  });
}

export async function upsertAgentTrackerEntry(
  filePath: string,
  entry: AgentTrackerInvocation
): Promise<void> {
  const tracker = await readAgentTracker(filePath);
  const existing = tracker.invocations.find(
    (item) => item.agent_name === entry.agent_name && item.agent_id === entry.agent_id
  );

  if (existing) {
    Object.assign(existing, entry, { updated_at: new Date().toISOString() });
  } else {
    tracker.invocations.push({
      ...entry,
      updated_at: new Date().toISOString()
    });
  }

  await writeJsonFile(filePath, tracker);
}

export async function appendToolLog(filePath: string, entry: Record<string, unknown>): Promise<void> {
  await ensureDir(path.dirname(filePath));
  const line = `${JSON.stringify({ ts: new Date().toISOString(), ...entry })}\n`;
  await writeFile(filePath, line, { encoding: "utf8", flag: "a" });
}
