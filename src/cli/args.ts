import type { SetupScope } from "../shared/paths.js";

export type CliCommand = "install" | "doctor";

export interface CliCommandOptions {
  scope?: SetupScope;
  version?: string;
  verbose: boolean;
  coreOnly: boolean;
}

export type ParsedCliArgs =
  | { kind: "version" }
  | { kind: "help"; command?: CliCommand }
  | { kind: "command"; command: CliCommand; options: CliCommandOptions }
  | { kind: "error"; message: string; command?: CliCommand };

const COMMANDS: CliCommand[] = ["install", "doctor"];

function isCliCommand(value: string): value is CliCommand {
  return COMMANDS.includes(value as CliCommand);
}

function parseScope(value: string | undefined): SetupScope | null {
  if (value === "user" || value === "project") return value;
  return null;
}

function parseCommandArgs(command: CliCommand, argv: string[]): ParsedCliArgs {
  const options: CliCommandOptions = {
    verbose: false,
    coreOnly: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === "--help" || token === "-h") {
      return { kind: "help", command };
    }

    if (token === "--verbose") {
      if (command !== "install") {
        return {
          kind: "error",
          command,
          message: `Unknown option "${token}" for ${command}.`
        };
      }
      options.verbose = true;
      continue;
    }

    if (token === "--core-only") {
      if (command !== "install") {
        return {
          kind: "error",
          command,
          message: `Unknown option "${token}" for ${command}.`
        };
      }
      options.coreOnly = true;
      continue;
    }

    if (token === "--scope") {
      const parsedScope = parseScope(argv[index + 1]);
      if (!parsedScope) {
        return {
          kind: "error",
          command,
          message: `Invalid --scope value "${argv[index + 1] ?? ""}". Expected "user" or "project".`
        };
      }
      options.scope = parsedScope;
      index += 1;
      continue;
    }

    if (token === "--version") {
      if (command !== "install") {
        return {
          kind: "error",
          command,
          message: `Unknown option "${token}" for ${command}.`
        };
      }

      const value = argv[index + 1];
      if (!value || value.startsWith("-")) {
        return {
          kind: "error",
          command,
          message: "Missing value for --version."
        };
      }
      options.version = value;
      index += 1;
      continue;
    }

    return {
      kind: "error",
      command,
      message: `Unknown option "${token}" for ${command}.`
    };
  }

  return {
    kind: "command",
    command,
    options
  };
}

export function parseCliArgs(argv: string[]): ParsedCliArgs {
  if (argv.length === 0) {
    return parseCommandArgs("install", []);
  }

  const [firstToken, ...rest] = argv;

  if (firstToken === "--help" || firstToken === "-h") {
    return { kind: "help" };
  }

  if (firstToken === "--version" || firstToken === "-v" || firstToken === "version") {
    return { kind: "version" };
  }

  if (!isCliCommand(firstToken)) {
    return {
      kind: "error",
      message: `Unknown command "${firstToken}".`
    };
  }

  return parseCommandArgs(firstToken, rest);
}
