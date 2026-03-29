import type { LoadedGatewayConfig } from './config.ts'
import type { DispatchResult } from './ipc.ts'
import type { GatewayIo } from './run.ts'

/**
 * Shared contract for `@omnibot/channel-*` packages loaded by the gateway host process.
 */
export interface GatewayPluginHostContext {
  channels: Record<string, { plugin: string; [key: string]: unknown }>
  /** Parsed `omni.yaml` root (plugin-specific keys live here). */
  document: Record<string, unknown>
  replyHandleTtlMs: number
}

/** Passed to {@link GatewayPluginHost.handleHttp} (e.g. webhook ingress, future channel HTTP). */
export interface GatewayPluginHttpContext {
  ttlMs: number
  config: LoadedGatewayConfig
}

export interface GatewayPluginHost {
  prepare(): void
  afterHubReady(io: GatewayIo): Promise<void>
  tryDispatchRoute(
    route: { kind?: string },
    action: string,
    args: Record<string, unknown>,
  ): Promise<DispatchResult | null>
  /**
   * Optional HTTP ingress. Return `null` to defer to the next plugin; otherwise the response is sent.
   */
  handleHttp?(
    req: Request,
    io: GatewayIo,
    ctx: GatewayPluginHttpContext,
  ): Promise<Response | null>
}

export type CreateGatewayPluginHost = (
  moduleExports: Record<string, unknown>,
  ctx: GatewayPluginHostContext,
) => GatewayPluginHost
