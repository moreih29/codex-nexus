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
        "setup     Install or refresh Codex Nexus surfaces",
        "install   Alias for setup",
        "update    Refresh installed Codex Nexus assets from the current package version",
        "doctor    Inspect the current Codex Nexus installation",
        "version   Print the installed codex-nexus version"
      ]
    },
    {
      title: "Behavior",
      lines: [
        "When stdin/stdout are TTYs and --scope is omitted, the CLI prompts for user vs project scope.",
        "When not running in a TTY, the CLI stays non-interactive and defaults scope to user."
      ]
    },
    {
      title: "Examples",
      lines: [
        "codex-nexus setup",
        "codex-nexus setup --scope project --verbose",
        "codex-nexus update --scope user",
        "codex-nexus doctor --scope project",
        "codex-nexus version"
      ]
    }
  ]);
}

function setupLikeHelp(command: "setup" | "install"): string {
  return renderHelp(`${command} command`, [
    {
      title: "Usage",
      lines: [`codex-nexus ${command} [options]`]
    },
    {
      title: "Options",
      lines: [
        "--scope <user|project>   Target Codex install scope (default: user when non-interactive)",
        "--verbose                Print a detailed installation summary",
        "--help                   Show this help"
      ]
    },
    {
      title: "Installs",
      lines: [
        ".codex/config.toml",
        ".codex/hooks.json",
        ".codex/skills/nx-init|nx-plan|nx-run|nx-sync",
        ".codex/agents/*.toml",
        "AGENTS.md Nexus section"
      ]
    }
  ]);
}

function updateHelp(): string {
  return renderHelp("update command", [
    {
      title: "Usage",
      lines: ["codex-nexus update [options]"]
    },
    {
      title: "Options",
      lines: [
        "--scope <user|project>   Target Codex install scope (default: user when non-interactive)",
        "--verbose                Print a detailed refresh summary",
        "--help                   Show this help"
      ]
    },
    {
      title: "Behavior",
      lines: [
        "Refreshes installed Codex Nexus assets from the currently installed package version.",
        "Does not change installation semantics; it rewrites managed Nexus assets in place."
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
  if (command === "setup" || command === "install") return setupLikeHelp(command);
  if (command === "update") return updateHelp();
  return doctorHelp();
}
