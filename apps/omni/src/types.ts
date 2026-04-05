import type { LoadedGatewayConfig } from '@omnibot/gateway'
import type { LoggingConfig } from '@omnibot/omnirouter'

export interface OmniServerConfig {
  hostname: string
  port: number
  bearerToken: string
}

/** In-process Anthropic proxy ({@link createOmnirouter}). */
export interface OmnirouterAppConfig {
  enabled: boolean
  listen: { hostname: string; port: number }
  upstreamBaseUrl: string
  /** When true or omitted, forward client model/tools unchanged. */
  passthrough: boolean
  /** Required when `passthrough` is false. */
  model?: string
  toolAllowlist?: string[]
  stripAdaptiveThinkingForModels?: string[]
  logging?: LoggingConfig
}

export interface AgentsConfig {
  baseDir: string
  defaultCmd: [string, ...string[]]
  defaultCols: number
  defaultRows: number
  /**
   * Base URL for `ANTHROPIC_BASE_URL` when `omnirouter.enabled` is false (external router).
   * When omnirouter is enabled, the app derives the URL from `omnirouter.listen` and ignores this.
   */
  omnirouterUrl: string | null
  templateDir: string | null
}

/** Full app config: gateway IPC/HTTP + channels + control plane + agents + omnirouter. */
export interface OmniConfig extends LoadedGatewayConfig {
  omniServer: OmniServerConfig
  agents: AgentsConfig
  omnirouter: OmnirouterAppConfig
}
