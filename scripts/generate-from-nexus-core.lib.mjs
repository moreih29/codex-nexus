import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const CODEX_NEXUS_ROOT = dirname(__dirname);
export const NEXUS_CORE_ROOT = join(CODEX_NEXUS_ROOT, "node_modules/@moreih29/nexus-core");

const PROMPT_FIELD_ORDER = [
  "name",
  "description",
  "category",
  "resume_tier",
  "model_tier"
];

const SKILL_FIELD_ORDER = [
  "name",
  "description",
  "trigger_display",
  "purpose"
];

const MACRO_RE = /\{\{(\w+)\s+(.*?)\}\}/g;
const MACRO_RE_SINGLE = /\{\{(\w+)\s+(.*?)\}\}/;

export function loadManifest() {
  return JSON.parse(readFileSync(join(NEXUS_CORE_ROOT, "manifest.json"), "utf8"));
}

export function verifyManifestVersion(manifest) {
  const pkg = JSON.parse(readFileSync(join(NEXUS_CORE_ROOT, "package.json"), "utf8"));
  if (manifest.nexus_core_version !== pkg.version) {
    throw new Error(
      `manifest.nexus_core_version (${manifest.nexus_core_version}) !== package.json version (${pkg.version})`
    );
  }
}

export function verifyBodyHash(content, expectedHashPrefixed, label = "") {
  const actual = `sha256:${createHash("sha256").update(content).digest("hex")}`;
  if (actual !== expectedHashPrefixed) {
    throw new Error(
      `body_hash mismatch${label ? ` for ${label}` : ""}: expected ${expectedHashPrefixed}, got ${actual}`
    );
  }
}

export function loadInvocationMap() {
  return parseYaml(readFileSync(join(CODEX_NEXUS_ROOT, "invocation-map.yml"), "utf8"));
}

export function loadInvocationsEnum() {
  const doc = parseYaml(readFileSync(join(NEXUS_CORE_ROOT, "vocabulary", "invocations.yml"), "utf8"));
  return new Set(doc.invocations.map((entry) => entry.id));
}

function collapseDescription(value) {
  return String(value).replace(/\s+/g, " ").trim();
}

function emitYamlValue(field, value) {
  if (typeof value === "boolean" || typeof value === "number") {
    return String(value);
  }

  const text = String(value);
  if (field === "purpose" || field === "trigger_display") {
    return `"${text.replaceAll('"', '\\"')}"`;
  }

  if (/[:#[\]{},&*!|>'"%@`]/.test(text) || /^\s|\s$/.test(text)) {
    return `"${text.replaceAll('"', '\\"')}"`;
  }

  return text;
}

function emitFrontmatter(fieldMap, fieldOrder) {
  const lines = ["---"];
  for (const field of fieldOrder) {
    if (!fieldMap.has(field)) continue;
    lines.push(`${field}: ${emitYamlValue(field, fieldMap.get(field))}`);
  }
  lines.push("---");
  return `${lines.join("\n")}\n`;
}

function deriveSkillTriggerDisplay(meta) {
  if (Array.isArray(meta.triggers) && meta.triggers.length > 0) {
    return `[${meta.triggers[0]}]`;
  }
  return `$${meta.id}`;
}

export function transformAgent(meta, body, invocationMap, invocationsEnum) {
  const fm = new Map();
  fm.set("name", meta.name);
  fm.set("description", collapseDescription(meta.description));
  fm.set("category", meta.category);
  fm.set("resume_tier", meta.resume_tier);
  fm.set("model_tier", meta.model_tier);
  return emitFrontmatter(fm, PROMPT_FIELD_ORDER) + `\n${expandMacros(body, invocationMap, invocationsEnum)}\n`;
}

export function transformSkill(meta, body, invocationMap, invocationsEnum) {
  const fm = new Map();
  fm.set("name", meta.id);
  fm.set("description", collapseDescription(meta.description));
  fm.set("trigger_display", deriveSkillTriggerDisplay(meta));
  fm.set("purpose", meta.summary ?? collapseDescription(meta.description));
  let prompt = expandMacros(body, invocationMap, invocationsEnum);
  const harnessDocRefs = invocationMap?.skill_harness_docs?.[meta.id];

  if (Array.isArray(harnessDocRefs)) {
    for (const ref of harnessDocRefs) {
      const docPath = join(CODEX_NEXUS_ROOT, "harness-content", `${ref}.md`);
      if (!existsSync(docPath)) {
        console.warn(
          `[generate-from-nexus-core] skill_harness_docs: "${ref}.md" not found at ${docPath} — skipping`
        );
        continue;
      }
      const content = readFileSync(docPath, "utf8").trim();
      prompt += `\n\n---\n\n## Harness-Specific: ${ref}\n\n${content}`;
    }
  }

  return emitFrontmatter(fm, SKILL_FIELD_ORDER) + `\n${prompt}\n`;
}

export function writeGenerated(dst, content) {
  const dir = dirname(dst);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(dst, content, "utf8");
}

export function parseMacroParams(raw) {
  const s = raw.trim();
  const params = {};
  let i = 0;

  while (i < s.length) {
    while (i < s.length && /\s/.test(s[i])) i += 1;
    if (i >= s.length) break;

    const keyStart = i;
    while (i < s.length && /[\w]/.test(s[i])) i += 1;
    const key = s.slice(keyStart, i);
    if (!key) throw new Error(`parseMacroParams: expected key at offset ${i}`);
    if (s[i] !== "=") throw new Error(`parseMacroParams: expected '=' after key "${key}"`);
    i += 1;

    let value;
    if (s[i] === '"') {
      let out = "";
      i += 1;
      while (i < s.length && s[i] !== '"') {
        if (s[i] === "\\" && i + 1 < s.length) {
          out += s[i + 1];
          i += 2;
        } else {
          out += s[i];
          i += 1;
        }
      }
      if (s[i] !== '"') throw new Error(`parseMacroParams: unterminated string for "${key}"`);
      i += 1;
      value = out;
    } else if (s[i] === "[" || s[i] === "{") {
      const open = s[i];
      const close = open === "[" ? "]" : "}";
      let depth = 1;
      const start = i;
      i += 1;
      while (i < s.length && depth > 0) {
        if (s[i] === '"') {
          i += 1;
          while (i < s.length && s[i] !== '"') {
            if (s[i] === "\\" && i + 1 < s.length) i += 2;
            else i += 1;
          }
          i += 1;
          continue;
        }
        if (s[i] === open) depth += 1;
        else if (s[i] === close) depth -= 1;
        i += 1;
      }
      value = s.slice(start, i);
    } else if (s[i] === ">" && s[i + 1] === ">") {
      i += 2;
      const start = i;
      while (i < s.length && /\w/.test(s[i])) i += 1;
      value = { heredoc: s.slice(start, i) };
    } else {
      const start = i;
      while (i < s.length && !/\s/.test(s[i])) i += 1;
      value = s.slice(start, i);
    }

    params[key] = value;
  }

  return params;
}

function normalizeSubagentRole(targetRole, cfg) {
  if (typeof targetRole !== "string" || targetRole.length === 0) return targetRole;
  return cfg.role_aliases?.[targetRole] ?? targetRole;
}

function deriveQuestionId(question) {
  const words = String(question).toLowerCase().match(/[a-z0-9]+/g) ?? [];
  if (words.length === 0) return "user_choice";
  return words.slice(0, 6).join("_");
}

export function expandPrimitive(primitive, params, invocationMap) {
  const cfg = invocationMap?.invocation_map?.[primitive] ?? {};

  if (primitive === "skill_activation") {
    const modeSuffix = params.mode ? ` (mode: ${params.mode})` : "";
    return `Load and follow the ${cfg.skill_prefix ?? "$"}${params.skill} skill now${modeSuffix}.`;
  }

  if (primitive === "subagent_spawn") {
    const agentType = normalizeSubagentRole(params.target_role, cfg);
    const lines = [
      `Use ${cfg.tool ?? "spawn_agent"} to spawn the ${agentType} subagent now.`,
      "Suggested call shape:",
      `- ${cfg.role_param ?? "agent_type"}: ${agentType}`
    ];
    if (params.name) lines.push(`- requested label: ${params.name}`);
    lines.push(`- ${cfg.message_param ?? "message"}:`);
    lines.push(String(params.prompt));
    return lines.join("\n");
  }

  if (primitive === "task_register") {
    if (cfg.tool) {
      return `Best effort only: if the runtime exposes a ${cfg.surface ?? "visual progress tracker"}, use ${cfg.tool} to keep the existing ${cfg.collection_param ?? "plan"} items in sync, setting the entry whose ${cfg.step_param ?? "step"} is "${params.label}" to ${cfg.status_param ?? "status"} "${params.state}" and appending it if missing. Do not use nx_task_add or nx_task_update for this primitive; those tools manage persistent Nexus task state rather than transient UI progress.`;
    }

    return `Best effort only: if the runtime exposes a ${cfg.surface ?? "visual progress tracker"}, register or update "${params.label}" there with state "${params.state}". Do not use nx_task_add or nx_task_update for this primitive; those tools manage persistent Nexus task state rather than transient UI progress.`;
  }

  if (primitive === "user_question") {
    const options = String(params.options ?? "").trim();
    if (options === "[]") {
      return `Ask the user this question in prose and wait for a free-form reply: ${params.question}`;
    }

    return [
      `If ${cfg.tool ?? "request_user_input"} is available in the current mode, use it with one question:`,
      `- header: ${cfg.header ?? "Question"}`,
      `- id: ${deriveQuestionId(params.question)}`,
      `- question: ${params.question}`,
      `- options: ${options}`,
      `If ${cfg.tool ?? "request_user_input"} is unavailable, ask the same question in prose and wait for the user's reply.`
    ].join("\n");
  }

  throw new Error(`Unknown primitive "${primitive}"`);
}

export function expandMacros(body, invocationMap, invocationsEnum) {
  const lines = body.split("\n");
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!MACRO_RE_SINGLE.test(line)) {
      out.push(line);
      i += 1;
      continue;
    }

    let heredocIdent = null;
    const firstMatch = line.match(MACRO_RE_SINGLE);
    if (firstMatch) {
      const params = parseMacroParams(firstMatch[2]);
      for (const value of Object.values(params)) {
        if (value && typeof value === "object" && typeof value.heredoc === "string") {
          heredocIdent = value.heredoc;
          break;
        }
      }
    }

    if (heredocIdent) {
      const heredocLines = [];
      let j = i + 1;
      while (j < lines.length && lines[j].trim() !== `<<${heredocIdent}`) {
        heredocLines.push(lines[j]);
        j += 1;
      }
      if (j >= lines.length) {
        throw new Error(`expandMacros: heredoc closure <<${heredocIdent} not found`);
      }
      const heredocContent = heredocLines.join("\n").trim();
      out.push(
        line.replace(MACRO_RE_SINGLE, (_match, primitive, raw) => {
          if (!invocationsEnum.has(primitive)) {
            throw new Error(`expandMacros: unknown primitive "${primitive}"`);
          }
          const params = parseMacroParams(raw);
          for (const [key, value] of Object.entries(params)) {
            if (value && typeof value === "object" && typeof value.heredoc === "string") {
              params[key] = heredocContent;
            }
          }
          return expandPrimitive(primitive, params, invocationMap);
        })
      );
      i = j + 1;
      continue;
    }

    out.push(
      line.replace(MACRO_RE, (_match, primitive, raw) => {
        if (!invocationsEnum.has(primitive)) {
          throw new Error(`expandMacros: unknown primitive "${primitive}"`);
        }
        return expandPrimitive(primitive, parseMacroParams(raw), invocationMap);
      })
    );
    i += 1;
  }

  return out.join("\n");
}
