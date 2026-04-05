import { join } from "node:path";

import type { OmnitoolRegistry } from "./types";
import { validateOmnitoolRegistry } from "./validateRegistry";

/** Path to JSON config. Override with `OMNITOOL_CONFIG`. */
export function getConfigPath(): string {
  return process.env.OMNITOOL_CONFIG ?? join(import.meta.dir, "..", "omnitool.config.json");
}

export async function loadConfigFromFile(
  path: string = getConfigPath(),
): Promise<OmnitoolRegistry> {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    throw new Error(`Config not found: ${path}`);
  }
  const data = (await file.json()) as unknown;
  return validateOmnitoolRegistry(data);
}

export const loadConfig = loadConfigFromFile;
