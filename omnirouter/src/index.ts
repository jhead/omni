export type {
  LoggingConfig,
  MessagesBody,
  ProxyConfig,
  ToolDef,
} from "./types";
export { loadConfig, loadConfigFromFile, getConfigPath } from "./config";
export { mergeProxyConfigPartial } from "./mergeConfig";
export { validateProxyConfig } from "./validateConfig";
export { createOmnirouterFetch } from "./handler";
export {
  createOmnirouter,
  type CreateOmnirouterOptions,
  type OmnirouterHandle,
} from "./omnirouter";
export { LOG_PREFIX, emitLog, logJsonPayload, resolveLogging } from "./logging";
export { forwardToAnthropicHeaders } from "./forwardHeaders";
export { transformMessagesBody } from "./transform";
export { tapUpstreamResponse } from "./responseTap";

import { getConfigPath, loadConfigFromFile } from "./config";
import { emitLog, LOG_PREFIX, resolveLogging } from "./logging";
import { createOmnirouter } from "./omnirouter";

if (import.meta.main) {
  const path = getConfigPath();
  const config = await loadConfigFromFile(path);
  const log = resolveLogging(config.logging);
  if (log.incomingRequest || log.outgoingRequest || log.response) {
    emitLog(`${LOG_PREFIX} config file: ${path}`);
  }
  createOmnirouter({ config });
}
