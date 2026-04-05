import { join } from "node:path";
import type { ProxyConfig } from "./types";
import { validateProxyConfig } from "./validateConfig";

const defaultPath = join(import.meta.dir, "..", "proxy.config.json");

/** Path to `proxy.config.json`. Override with `OMNIRouter_CONFIG`. */
export function getConfigPath(): string {
  return process.env.OMNIRouter_CONFIG ?? defaultPath;
}

/** Load and validate JSON from disk. */
export async function loadConfigFromFile(
  path: string = getConfigPath(),
): Promise<ProxyConfig> {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    throw new Error(`Config not found: ${path}`);
  }
  const data = (await file.json()) as ProxyConfig;
  validateProxyConfig(data);
  return data;
}

/** Alias for {@link loadConfigFromFile}. */
export const loadConfig = loadConfigFromFile;
