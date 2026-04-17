import type { CliCommand } from "./args.js";

interface HelpSection {
  title: string;
  lines: string[];
}

function renderHelp(title: string, sections: HelpSection[]): string {
  const chunks: string[] = [title, ""];

  for (const section of sections) {
    chunks.push(`${section.title}:`);
    chunks.push(...section.lines.map((line) => `  ${line}`));
    chunks.push("");
  }

  return chunks.join("\n").trimEnd();
}

function topLevelHelp(): string {
  return renderHelp("codex-nexus CLI", [
    {
      title: "Usage",
      lines: [
        "codex-nexus <command> [options]",
        "codex-nexus --help",
        "codex-nexus --version",
        "codex-nexus version",
        "codex-nexus"
      ]
    },
    {
      title: "Commands",
      lines: [
        "install   Install Codex Nexus surfaces for a scope and version",
        "doctor    Inspect the current Codex Nexus installation",
        "version   Print the installed codex-nexus version"
      ]
    },
    {
      title: "Behavior",
      lines: [
        "When stdin/stdout are TTYs and install values are omitted, the CLI prompts for version and scope.",
        "When not running in a TTY, install defaults to latest + user scope with optional MCP integrations enabled."
      ]
    },
    {
      title: "Examples",
      lines: [
        "codex-nexus install",
        "codex-nexus install --scope project --version 0.1.0 --verbose",
        "codex-nexus doctor --scope project",
        "codex-nexus version"
      ]
    }
  ]);
}

function installHelp(): string {
  return renderHelp("install command", [
    {
      title: "Usage",
      lines: ["codex-nexus install [options]"]
    },
    {
      title: "Options",
      lines: [
        "--scope <user|project>   Target Codex install scope (default: user when non-interactive)",
        "--version <value>        Package version or dist-tag to install (default: latest when non-interactive)",
        "--core-only              Install only the core Nexus MCP setup and skip default optional MCP integrations",
        "--verbose                Print a detailed installation summary",
        "--help                   Show this help"
      ]
    },
    {
      title: "Defaults",
      lines: [
        "Install writes the nx MCP server and, by default, optional MCP integrations such as hosted Context7.",
        "Context7 uses bearer_token_env_var = CONTEXT7_API_KEY in .codex/config.toml."
      ]
    },
    {
      title: "Installs",
      lines: [
        ".codex/packages/node_modules/codex-nexus",
        ".codex/config.toml",
        ".codex/hooks.json",
        ".codex/skills/nx-init|nx-plan|nx-run|nx-sync",
        ".codex/agents/*.toml",
        "AGENTS.md Nexus section"
      ]
    },
    {
      title: "Examples",
      lines: [
        "codex-nexus install",
        "codex-nexus install --core-only",
        "codex-nexus install --scope user",
        "codex-nexus install --scope project --version 0.1.0",
        "codex-nexus install --scope user --version latest --verbose"
      ]
    }
  ]);
}

function doctorHelp(): string {
  return renderHelp("doctor command", [
    {
      title: "Usage",
      lines: ["codex-nexus doctor [options]"]
    },
    {
      title: "Options",
      lines: [
        "--scope <user|project>   Target Codex install scope (default: user when non-interactive)",
        "--help                   Show this help"
      ]
    },
    {
      title: "Checks",
      lines: [
        "Managed config files",
        "Installed skills",
        "Installed native agents"
      ]
    }
  ]);
}

export function renderCommandHelp(command?: CliCommand): string {
  if (!command) return topLevelHelp();
  if (command === "install") return installHelp();
  return doctorHelp();
}
