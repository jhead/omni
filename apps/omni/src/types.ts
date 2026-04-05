import type { LoadedGatewayConfig } from '@omnibot/gateway'

export interface OmniServerConfig {
  hostname: string
  port: number
  bearerToken: string
}

export interface AgentsConfig {
  baseDir: string
  defaultCmd: [string, ...string[]]
  defaultCols: number
  defaultRows: number
  omnirouterUrl: string
  templateDir: string | null
}

/** Full app config: gateway IPC/HTTP + channels + control plane + agents. */
export interface OmniConfig extends LoadedGatewayConfig {
  omniServer: OmniServerConfig
  agents: AgentsConfig
}
