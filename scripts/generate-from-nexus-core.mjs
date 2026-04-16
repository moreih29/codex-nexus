import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import {
  CODEX_NEXUS_ROOT,
  NEXUS_CORE_ROOT,
  loadManifest,
  verifyManifestVersion,
  verifyBodyHash,
  transformAgent,
  transformSkill,
  writeGenerated,
  loadInvocationMap,
  loadInvocationsEnum
} from "./generate-from-nexus-core.lib.mjs";

const EXCLUDED_AGENT_IDS = new Set(["nexus"]);

async function main() {
  const manifest = loadManifest();
  verifyManifestVersion(manifest);

  const invocationMap = loadInvocationMap();
  const invocationsEnum = loadInvocationsEnum();

  let agentCount = 0;
  for (const agentEntry of manifest.agents) {
    if (EXCLUDED_AGENT_IDS.has(agentEntry.id)) {
      continue;
    }

    const metaPath = join(NEXUS_CORE_ROOT, "agents", agentEntry.id, "meta.yml");
    const bodyPath = join(NEXUS_CORE_ROOT, "agents", agentEntry.id, "body.md");
    const meta = parseYaml(readFileSync(metaPath, "utf8"));
    const body = readFileSync(bodyPath, "utf8");
    verifyBodyHash(body, agentEntry.body_hash, `agents/${agentEntry.id}/body.md`);
    const out = transformAgent(meta, body, invocationMap, invocationsEnum);
    writeGenerated(join(CODEX_NEXUS_ROOT, "prompts", `${agentEntry.id}.md`), out);
    agentCount += 1;
  }

  for (const excludedAgentId of EXCLUDED_AGENT_IDS) {
    const stalePromptPath = join(CODEX_NEXUS_ROOT, "prompts", `${excludedAgentId}.md`);
    if (existsSync(stalePromptPath)) {
      rmSync(stalePromptPath, { force: true });
    }
  }

  let skillCount = 0;
  for (const skillEntry of manifest.skills) {
    const metaPath = join(NEXUS_CORE_ROOT, "skills", skillEntry.id, "meta.yml");
    const bodyPath = join(NEXUS_CORE_ROOT, "skills", skillEntry.id, "body.md");
    const meta = parseYaml(readFileSync(metaPath, "utf8"));
    const body = readFileSync(bodyPath, "utf8");
    verifyBodyHash(body, skillEntry.body_hash, `skills/${skillEntry.id}/body.md`);
    const out = transformSkill(meta, body, invocationMap, invocationsEnum);
    writeGenerated(join(CODEX_NEXUS_ROOT, "skills", skillEntry.id, "SKILL.md"), out);
    skillCount += 1;
  }

  console.log(
    `Generated from @moreih29/nexus-core@${manifest.nexus_core_version}: ${agentCount} agents, ${skillCount} skills`
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
