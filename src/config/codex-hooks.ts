import { readFileSync } from "node:fs";
import {
  nexusCoreCodexHookManifestPath,
  nexusCoreCodexHookRuntimePath
} from "./nexus-core.js";

type HookEventName = "SessionStart" | "UserPromptSubmit" | "SubagentStart" | "SubagentStop";
type HookEntry = {
  command: string;
  timeout?: number;
};
type HookManifest = {
  hooks: Partial<Record<HookEventName, HookEntry[]>>;
};

function clone<T>(value: T): T {
  return structuredClone(value);
}

function safeObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function rewriteHookCommand(command: string, packageRoot: string): string {
  const match = command.match(/dist\/hooks\/([^"\s]+\.js)/);
  if (!match) {
    throw new Error(`Unsupported nexus-core Codex hook command: ${command}`);
  }

  return `node "${nexusCoreCodexHookRuntimePath(packageRoot, match[1])}"`;
}

function loadCoreHookManifest(packageRoot: string): HookManifest {
  return JSON.parse(readFileSync(nexusCoreCodexHookManifestPath(packageRoot), "utf8")) as HookManifest;
}

export function buildManagedHooks(packageRoot: string): Record<HookEventName, unknown[]> {
  const manifest = loadCoreHookManifest(packageRoot);
  const managed = {} as Record<HookEventName, unknown[]>;

  for (const eventName of Object.keys(manifest.hooks) as HookEventName[]) {
    managed[eventName] = (manifest.hooks[eventName] ?? []).map((entry) => ({
      ...entry,
      command: rewriteHookCommand(entry.command, packageRoot)
    }));
  }

  return managed;
}

function isManagedHookCommand(command: string): boolean {
  return /codex-native-hook\.js(?:["\s]|$)/.test(command) ||
    (/nexus-core/.test(command) &&
      /(?:agent-bootstrap|agent-finalize|prompt-router|session-init)\.js(?:["\s]|$)/.test(command));
}

function stripManagedEntry(entry: unknown): unknown | null {
  const record = safeObject(entry);
  if (!record || !Array.isArray(record.hooks)) return clone(entry);
  const nextHooks = record.hooks.filter((hook) => {
    const hookRecord = safeObject(hook);
    return !(
      hookRecord?.type === "command" &&
      typeof hookRecord.command === "string" &&
      isManagedHookCommand(hookRecord.command)
    );
  });
  if (nextHooks.length === 0) return null;
  return {
    ...record,
    hooks: nextHooks
  };
}

export function mergeManagedHooks(existingContent: string | null, packageRoot: string): string {
  const managed = buildManagedHooks(packageRoot);
  const parsed = existingContent ? JSON.parse(existingContent) as Record<string, unknown> : {};
  const hooks = safeObject(parsed.hooks) ?? {};

  for (const [eventName, entries] of Object.entries(managed) as Array<[HookEventName, unknown[]]>) {
    const existingEntries = Array.isArray(hooks[eventName]) ? hooks[eventName] : [];
    const preserved = existingEntries
      .map((entry) => stripManagedEntry(entry))
      .filter((entry) => entry !== null);
    hooks[eventName] = [...preserved, ...entries.map((entry) => clone(entry))];
  }

  return JSON.stringify({ ...parsed, hooks }, null, 2) + "\n";
}
