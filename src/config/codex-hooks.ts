import path from "node:path";

type HookEventName = "SessionStart" | "UserPromptSubmit" | "PreToolUse" | "PostToolUse" | "Stop";

function clone<T>(value: T): T {
  return structuredClone(value);
}

function safeObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function buildCommandEntry(command: string, matcher?: string): Record<string, unknown> {
  return {
    ...(matcher ? { matcher } : {}),
    hooks: [
      {
        type: "command",
        command
      }
    ]
  };
}

function hookCommand(packageRoot: string): string {
  return `bun "${path.join(packageRoot, "dist", "hooks", "codex-native-hook.js")}"`;
}

export function buildManagedHooks(packageRoot: string): Record<HookEventName, unknown[]> {
  const command = hookCommand(packageRoot);
  return {
    SessionStart: [buildCommandEntry(command)],
    UserPromptSubmit: [buildCommandEntry(command)],
    PreToolUse: [buildCommandEntry(command, "Bash")],
    PostToolUse: [buildCommandEntry(command, "Bash")],
    Stop: [buildCommandEntry(command)]
  };
}

function isManagedHookCommand(command: string): boolean {
  return /codex-native-hook\.js(?:["\s]|$)/.test(command);
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
