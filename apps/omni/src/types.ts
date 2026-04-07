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
  /**
   * SQLite registry for agent metadata (survives restarts; PTYs are still recreated via Restart).
   * Resolved relative to the directory containing `omni.config.yaml`.
   */
  persistenceDbPath: string
  /**
   * Base URL for `ANTHROPIC_BASE_URL` when `omnirouter.enabled` is false (external router).
   * When omnirouter is enabled, the app derives the URL from `omnirouter.listen` and ignores this.
   */
  omnirouterUrl: string | null
  /**
   * When `channels` includes `channel-agent-bus`, each new MCP HTTP session auto-subscribes to this
   * topic so agents receive peer traffic without calling `subscribe` first.
   * Omit → use `omni-agents`. Set to `null` or `false` in YAML to disable.
   */
  agentBusAutoSubscribeTopic: string | null | undefined
}

/** YAML-only seed for the `default` agent template row (used when DB has no `default` yet). */
export interface DeprecatedAgentsTemplateSeed {
  templateDir?: string | null
  defaultCmd?: [string, ...string[]]
  defaultCols?: number
  defaultRows?: number
}

/** Persisted row in `omni_agent_templates`. */
export interface AgentTemplateRow {
  id: string
  name: string
  isSystem: boolean
  /** Relative to `omni.config.yaml` directory, or absolute path. */
  templateDir: string | null
  claudeMd: string | null
  /** Partial JSON merged into agent `.claude/settings.json`. */
  settingsJson: Record<string, unknown> | null
  defaultCmd: [string, ...string[]] | null
  defaultCols: number | null
  defaultRows: number | null
}

/** Full app config: gateway IPC/HTTP + channels + control plane + agents + omnirouter. */
export interface OmniConfig extends LoadedGatewayConfig {
  omniServer: OmniServerConfig
  agents: AgentsConfig
  omnirouter: OmnirouterAppConfig
  /**
   * Present when deprecated YAML keys under `agents:` were used; seeds the `default` template once if missing.
   */
  deprecatedAgentsTemplateSeed?: DeprecatedAgentsTemplateSeed
}
