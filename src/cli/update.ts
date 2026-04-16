import type { SetupScope } from "../shared/paths.js";
import { setupCommand, type SetupResult } from "./setup.js";

export async function updateCommand(scope: SetupScope): Promise<SetupResult> {
  return setupCommand({ scope });
}
