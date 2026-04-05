export type { CreateOmnitoolOptions, OmnitoolHandle } from "./omnitool";
export { createOmnitool } from "./omnitool";
export type {
  BackendServerEntry,
  HttpServerDef,
  ListenConfig,
  OmnitoolRegistry,
  OmnitoolStatus,
  StdioServerDef,
} from "./types";
export {
  getConfigPath,
  loadConfig,
  loadConfigFromFile,
} from "./config";
export {
  mergeRegistryPartial,
  omnitoolRegistrySchema,
  serverEntrySchema,
  validateOmnitoolRegistry,
  validateServerEntry,
} from "./validateRegistry";
export { parsePrefixedToolName, makePrefixedToolName } from "./aggregateTools";

import { getConfigPath, loadConfigFromFile } from "./config";
import { createOmnitool } from "./omnitool";

if (import.meta.main) {
  const path = getConfigPath();
  const registry = await loadConfigFromFile(path);
  const o = createOmnitool({ registry, autoStart: false });
  await o.start();
  console.error(
    `omnitool: config ${path} — ${o.url?.href ?? `http://${registry.listen.hostname}:${registry.listen.port}`} (MCP ${registry.mcpPath}, admin /status /registry)`,
  );
}
