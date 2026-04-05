import type { ProxyConfig } from '@omnibot/omnirouter'

import type { OmnirouterAppConfig, OmniConfig } from './types.ts'

export function buildOmnirouterProxyConfig(cfg: OmnirouterAppConfig): ProxyConfig {
  const passthrough = cfg.passthrough !== false
  return {
    listen: { ...cfg.listen },
    upstreamBaseUrl: cfg.upstreamBaseUrl.replace(/\/$/, ''),
    passthrough,
    model: cfg.model,
    toolAllowlist: cfg.toolAllowlist,
    logging: cfg.logging,
    stripAdaptiveThinkingForModels: cfg.stripAdaptiveThinkingForModels,
  }
}

/** Base URL for agent `ANTHROPIC_BASE_URL` (in-process router or external). */
export function resolveAnthropicProxyBaseUrl(cfg: OmniConfig): string {
  if (cfg.omnirouter.enabled) {
    const { hostname, port } = cfg.omnirouter.listen
    return new URL(`http://${hostname}:${port}`).origin
  }
  const u = cfg.agents.omnirouterUrl?.trim()
  if (!u) {
    throw new Error(
      'omni config: agents.omnirouterUrl is required when omnirouter.enabled is false',
    )
  }
  return u.replace(/\/$/, '')
}
