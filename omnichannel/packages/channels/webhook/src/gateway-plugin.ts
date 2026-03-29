import type { OmnichannelEvent } from '@omnibot/core'
import {
  deleteQueuedEvent as dbDeleteQueuedEvent,
  insertQueuedEvent as dbInsertQueuedEvent,
  type GatewayIo,
  type GatewayPluginHost,
  type GatewayPluginHostContext,
  type GatewayPluginHttpContext,
} from '@omnibot/gateway'

import { handleWebhookPost } from './webhook-ingress.ts'

/** Ingress-only channel: no egress via `omni_dispatch` from stored routes. */
export function createGatewayPluginHost(
  _moduleExports: Record<string, unknown>,
  _ctx: GatewayPluginHostContext,
): GatewayPluginHost {
  return {
    prepare() {},
    async afterHubReady() {},
    async tryDispatchRoute() {
      return null
    },
    async handleHttp(req: Request, io: GatewayIo, httpCtx: GatewayPluginHttpContext) {
      return handleWebhookPost(req, buildWebhookIngressContext(io, httpCtx))
    },
  }
}

function buildWebhookIngressContext(
  io: GatewayIo,
  { ttlMs, config }: GatewayPluginHttpContext,
) {
  return {
    ttlMs,
    resolveChannel: (channelId: string) => {
      const ch = config.channels[channelId]
      if (!ch) return null
      return { plugin: ch.plugin }
    },
    hooks: {
      insertQueuedEvent(event: OmnichannelEvent, expiresAt: number): void {
        dbInsertQueuedEvent(io.db, event, expiresAt)
      },
      deleteQueuedEvent(id: string): void {
        dbDeleteQueuedEvent(io.db, id)
      },
      getIpcClientCount(): number {
        return io.hub.clientCount
      },
      broadcastEvent(event: OmnichannelEvent): void {
        io.hub.broadcast({ type: 'event', event })
      },
    },
  }
}
