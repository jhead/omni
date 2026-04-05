import type { LoggingConfig, ProxyConfig } from "./types";

/** Merge `patch` into `base`. Omitted keys keep `base`; present keys replace (including full `toolAllowlist` / `stripAdaptiveThinkingForModels` arrays). */
export function mergeProxyConfigPartial(
  base: ProxyConfig,
  patch: Partial<ProxyConfig>,
): ProxyConfig {
  return {
    listen:
      patch.listen !== undefined
        ? { ...base.listen, ...patch.listen }
        : base.listen,
    upstreamBaseUrl: patch.upstreamBaseUrl ?? base.upstreamBaseUrl,
    passthrough: patch.passthrough !== undefined ? patch.passthrough : base.passthrough,
    model: patch.model ?? base.model,
    toolAllowlist:
      patch.toolAllowlist !== undefined
        ? [...patch.toolAllowlist]
        : [...(base.toolAllowlist ?? [])],
    logging: mergeLogging(base.logging, patch.logging),
    stripAdaptiveThinkingForModels:
      patch.stripAdaptiveThinkingForModels !== undefined
        ? [...patch.stripAdaptiveThinkingForModels]
        : base.stripAdaptiveThinkingForModels !== undefined
          ? [...base.stripAdaptiveThinkingForModels]
          : undefined,
  };
}

function mergeLogging(
  base: ProxyConfig["logging"],
  patch: Partial<ProxyConfig>["logging"],
): LoggingConfig | undefined {
  if (patch === undefined) return base;
  if (base === undefined) return patch as LoggingConfig;
  return { ...base, ...patch };
}
