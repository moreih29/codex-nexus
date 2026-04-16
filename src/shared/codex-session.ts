import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { ToolLogEntry } from "./state.js";

export const CODEX_TURN_METADATA_KEY = "x-codex-turn-metadata";

export interface CodexTurnMetadata {
  session_id?: string;
  thread_source?: string;
  turn_id?: string;
}

export interface CodexSubagentSessionInfo {
  sessionId: string;
  parentSessionId?: string;
  agentRole?: string;
  agentNickname?: string;
  agentPath?: string | null;
  depth?: number;
  transcriptPath?: string | null;
}

interface CodexSessionMetaPayload {
  id?: unknown;
  agent_nickname?: unknown;
  agent_role?: unknown;
  source?: unknown;
}

interface CodexRolloutLine {
  timestamp?: unknown;
  type?: unknown;
  payload?: unknown;
}

function safeString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function safeObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function safeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function safeBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function resolveToolStatus(payload: Record<string, unknown> | null | undefined): string {
  if (!payload) return "completed";
  return safeString(payload.status)
    ?? (safeBoolean(payload.success) === false ? "failed" : "completed");
}

function collectPatchPathsFromPatchText(patchText: string): string[] {
  const paths: string[] = [];
  for (const rawLine of patchText.split(/\r?\n/)) {
    const line = rawLine.trim();
    const fileMatch = line.match(/^\*\*\* (?:Update|Add|Delete) File:\s+(.+)$/);
    if (fileMatch?.[1]) {
      paths.push(fileMatch[1].trim());
      continue;
    }
    const moveMatch = line.match(/^\*\*\* Move to:\s+(.+)$/);
    if (moveMatch?.[1]) {
      paths.push(moveMatch[1].trim());
    }
  }
  return Array.from(new Set(paths.filter((item) => item.length > 0)));
}

function collectPatchPathsFromInput(value: unknown): string[] {
  const text = safeString(value);
  if (text) {
    const directPaths = collectPatchPathsFromPatchText(text);
    if (directPaths.length > 0) return directPaths;
    try {
      const parsed = JSON.parse(text) as unknown;
      const parsedPaths = collectPatchPathsFromInput(parsed);
      if (parsedPaths.length > 0) return parsedPaths;
    } catch {
      // Ignore malformed JSON payloads and continue best-effort parsing.
    }
  }

  const object = safeObject(value);
  if (!object) return [];

  const candidates = [
    object.patch,
    object.input,
    object.arguments,
    object.args,
    object.content
  ];
  for (const candidate of candidates) {
    const candidatePaths = collectPatchPathsFromInput(candidate);
    if (candidatePaths.length > 0) return candidatePaths;
  }
  return [];
}

export function readApplyPatchPathsFromInput(value: unknown): string[] {
  return collectPatchPathsFromInput(value);
}

function collectPatchPathsFromChanges(changes: Record<string, unknown>): string[] {
  const paths: string[] = [];
  for (const [filePath, changeValue] of Object.entries(changes)) {
    if (filePath.trim().length > 0) {
      paths.push(filePath);
    }
    const changeObject = safeObject(changeValue);
    const movePath = safeString(changeObject?.move_path ?? changeObject?.movePath);
    if (movePath) {
      paths.push(movePath);
    }
  }
  return Array.from(new Set(paths));
}

function defaultCodexHomeDir(): string {
  return process.env.CODEX_HOME ?? path.join(process.env.HOME ?? "~", ".codex");
}

async function findRolloutPathBySessionId(dirPath: string, sessionId: string): Promise<string | null> {
  if (!existsSync(dirPath)) return null;

  const entries = await readdir(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      const nested = await findRolloutPathBySessionId(fullPath, sessionId);
      if (nested) return nested;
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(`${sessionId}.jsonl`)) {
      return fullPath;
    }
  }

  return null;
}

async function readSessionMetaPayload(filePath: string): Promise<CodexSessionMetaPayload | null> {
  if (!existsSync(filePath)) return null;

  const raw = await readFile(filePath, "utf8");
  const firstLine = raw.split(/\r?\n/, 1)[0]?.trim();
  if (!firstLine) return null;

  const parsed = JSON.parse(firstLine) as { type?: unknown; payload?: unknown };
  if (parsed.type !== "session_meta") return null;

  const payload = safeObject(parsed.payload);
  return payload as CodexSessionMetaPayload | null;
}

async function resolveSessionMetaPayload(options: {
  sessionId?: string;
  transcriptPath?: string | null;
  codexHomeDir?: string;
}): Promise<{ payload: CodexSessionMetaPayload; transcriptPath: string | null } | null> {
  const transcriptPath = safeString(options.transcriptPath) ?? null;
  if (transcriptPath) {
    const payload = await readSessionMetaPayload(transcriptPath);
    if (payload) {
      return { payload, transcriptPath };
    }
  }

  const sessionId = safeString(options.sessionId);
  if (!sessionId) return null;

  const sessionsRoot = path.join(options.codexHomeDir ?? defaultCodexHomeDir(), "sessions");
  const rolloutPath = await findRolloutPathBySessionId(sessionsRoot, sessionId);
  if (!rolloutPath) return null;

  const payload = await readSessionMetaPayload(rolloutPath);
  if (!payload) return null;

  return { payload, transcriptPath: rolloutPath };
}

async function resolveTranscriptPath(options: {
  sessionId?: string;
  transcriptPath?: string | null;
  codexHomeDir?: string;
}): Promise<string | null> {
  const transcriptPath = safeString(options.transcriptPath) ?? null;
  if (transcriptPath) return transcriptPath;

  const sessionId = safeString(options.sessionId);
  if (!sessionId) return null;

  const sessionsRoot = path.join(options.codexHomeDir ?? defaultCodexHomeDir(), "sessions");
  return findRolloutPathBySessionId(sessionsRoot, sessionId);
}

export function readTurnMetadataFromRequestMeta(meta: unknown): CodexTurnMetadata | null {
  const metaObject = safeObject(meta);
  if (!metaObject) return null;

  const rawTurnMetadata = metaObject[CODEX_TURN_METADATA_KEY];
  let turnMetadataObject: Record<string, unknown> | null;
  if (typeof rawTurnMetadata === "string") {
    try {
      turnMetadataObject = safeObject(JSON.parse(rawTurnMetadata) as unknown);
    } catch {
      return null;
    }
  } else {
    turnMetadataObject = safeObject(rawTurnMetadata);
  }

  if (!turnMetadataObject) return null;

  return {
    session_id: safeString(turnMetadataObject.session_id),
    thread_source: safeString(turnMetadataObject.thread_source),
    turn_id: safeString(turnMetadataObject.turn_id)
  };
}

export async function readSubagentSessionInfo(options: {
  sessionId?: string;
  transcriptPath?: string | null;
  codexHomeDir?: string;
}): Promise<CodexSubagentSessionInfo | null> {
  const resolved = await resolveSessionMetaPayload(options);
  if (!resolved) return null;

  const source = safeObject(resolved.payload.source);
  const subagent = safeObject(source?.subagent);
  const threadSpawn = safeObject(subagent?.thread_spawn);
  if (!threadSpawn) return null;

  const sessionId = safeString(resolved.payload.id) ?? safeString(options.sessionId);
  if (!sessionId) return null;

  return {
    sessionId,
    parentSessionId: safeString(threadSpawn.parent_thread_id),
    agentRole: safeString(threadSpawn.agent_role) ?? safeString(resolved.payload.agent_role),
    agentNickname: safeString(threadSpawn.agent_nickname) ?? safeString(resolved.payload.agent_nickname),
    agentPath: typeof threadSpawn.agent_path === "string" ? threadSpawn.agent_path : null,
    depth: safeNumber(threadSpawn.depth),
    transcriptPath: resolved.transcriptPath
  };
}

export async function readTranscriptToolLogEntries(options: {
  sessionId?: string;
  transcriptPath?: string | null;
  codexHomeDir?: string;
}): Promise<ToolLogEntry[]> {
  const transcriptPath = await resolveTranscriptPath(options);
  if (!transcriptPath || !existsSync(transcriptPath)) return [];

  const raw = await readFile(transcriptPath, "utf8");
  const sessionId = safeString(options.sessionId);
  const entries: ToolLogEntry[] = [];
  const seen = new Set<string>();

  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;

    let parsed: CodexRolloutLine;
    try {
      parsed = JSON.parse(line) as CodexRolloutLine;
    } catch {
      continue;
    }
    const timestamp = safeString(parsed.timestamp) ?? new Date().toISOString();

    if (parsed.type === "event_msg") {
      const payload = safeObject(parsed.payload);
      if (safeString(payload?.type) !== "patch_apply_end") continue;

      const callId = safeString(payload?.call_id ?? payload?.callId);
      const status = resolveToolStatus(payload);
      const changes = safeObject(payload?.changes);
      if (!changes) continue;
      const touchedPaths = collectPatchPathsFromChanges(changes);

      for (const touchedPath of touchedPaths) {
        const entry: ToolLogEntry = {
          ts: timestamp,
          session_id: sessionId,
          tool_name: "apply_patch",
          call_id: callId,
          path: touchedPath,
          status
        };
        const key = [
          entry.session_id ?? "",
          entry.call_id ?? "",
          entry.tool_name,
          entry.path,
          entry.status ?? ""
        ].join("\u0000");
        if (seen.has(key)) continue;
        seen.add(key);
        entries.push(entry);
      }
      continue;
    }

    if (parsed.type === "response_item") {
      const payload = safeObject(parsed.payload);
      const item = safeObject(payload?.item) ?? payload;
      const itemType = safeString(item?.type);
      if (itemType !== "custom_tool_call" && itemType !== "function_call") continue;

      const toolName = safeString(item?.name ?? item?.tool_name ?? item?.toolName);
      if (toolName !== "apply_patch") continue;

      const callId = safeString(item?.call_id ?? item?.callId ?? item?.id);
      const status = resolveToolStatus(item);
      const output = safeObject(item?.output);
      const outputChanges = safeObject(output?.changes ?? item?.changes);
      const touchedPathsFromInput = collectPatchPathsFromInput(item?.input ?? item?.arguments ?? item?.args);
      const touchedPaths = touchedPathsFromInput.length > 0
        ? touchedPathsFromInput
        : (outputChanges ? collectPatchPathsFromChanges(outputChanges) : []);
      if (touchedPaths.length === 0) continue;

      for (const touchedPath of touchedPaths) {
        const entry: ToolLogEntry = {
          ts: timestamp,
          session_id: sessionId,
          tool_name: toolName,
          call_id: callId,
          path: touchedPath,
          status
        };
        const key = [
          entry.session_id ?? "",
          entry.call_id ?? "",
          entry.tool_name,
          entry.path,
          entry.status ?? ""
        ].join("\u0000");
        if (seen.has(key)) continue;
        seen.add(key);
        entries.push(entry);
      }
    }
  }

  return entries;
}
