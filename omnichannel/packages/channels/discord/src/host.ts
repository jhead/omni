/**
 * Gateway host wiring for Discord.
 */

import type { Database } from 'bun:sqlite'

import type {
  DispatchResult,
  GatewayIo,
  GatewayPluginHost,
  GatewayPluginHostContext,
  IpcHub,
} from '@omnibot/gateway'
import {
  deleteQueuedEvent as dbDeleteQueuedEvent,
  insertQueuedEvent as dbInsertQueuedEvent,
  insertReplyHandle,
} from '@omnibot/gateway'

import { createDiscordClient, startDiscordBot } from './bot.ts'
import type { DiscordRuntime } from './bot.ts'
import {
  assertDiscordChannelsHaveIds,
  getDiscordBotToken,
  type DiscordTokenSource,
} from './config-helpers.ts'
import { executeDiscordDispatch } from './dispatch-exec.ts'
import type { DiscordRouteData } from './route.ts'
import type { DiscordIngressHub, DiscordIngressStore } from './types.ts'

export interface DiscordHostModule {
  assertDiscordChannelsHaveIds: typeof assertDiscordChannelsHaveIds
  getDiscordBotToken: typeof getDiscordBotToken
  createDiscordClient: typeof createDiscordClient
  startDiscordBot: typeof startDiscordBot
  executeDiscordDispatch: typeof executeDiscordDispatch
}

export function parseDiscordSubscriptions(
  channels: Record<string, { plugin: string; discordChannelId?: unknown }>,
): Array<{ omniChannelId: string; discordChannelId: string }> {
  return Object.entries(channels)
    .filter(([, ch]) => ch.plugin === 'channel-discord' && ch.discordChannelId)
    .map(([omniChannelId, ch]) => ({
      omniChannelId,
      discordChannelId: String(ch.discordChannelId).trim(),
    }))
}

function tokenSourceFromDocument(
  channels: GatewayPluginHostContext['channels'],
  document: Record<string, unknown>,
): DiscordTokenSource {
  return {
    discord: document.discord as { token?: string } | undefined,
    gateway: {
      discordBotTokenEnv: (document.gateway as { discordBotTokenEnv?: string } | undefined)
        ?.discordBotTokenEnv,
    },
    channels: channels as DiscordTokenSource['channels'],
  }
}

function wrapDiscordStore(db: Database): DiscordIngressStore {
  return {
    insertReplyHandle(
      id: string,
      omniChannelId: string,
      routeJson: string,
      expiresAt: number,
    ): void {
      insertReplyHandle(db, id, omniChannelId, routeJson, expiresAt)
    },
    insertQueuedEvent(event, expiresAt): void {
      dbInsertQueuedEvent(db, event, expiresAt)
    },
    deleteQueuedEvent(id: string): void {
      dbDeleteQueuedEvent(db, id)
    },
  }
}

function wrapDiscordHub(hub: IpcHub): DiscordIngressHub {
  return {
    get clientCount() {
      return hub.clientCount
    },
    broadcastEvent(event): void {
      hub.broadcast({ type: 'event', event })
    },
  }
}

export function createGatewayPluginHost(
  moduleExports: Record<string, unknown>,
  options: GatewayPluginHostContext,
): GatewayPluginHost {
  const mod = moduleExports as unknown as DiscordHostModule
  const subscriptions = parseDiscordSubscriptions(options.channels)
  const tokenSrc = () =>
    tokenSourceFromDocument(options.channels, options.document)
  const { replyHandleTtlMs } = options

  let runtime: DiscordRuntime | null = null

  const prepare = (): void => {
    if (subscriptions.length === 0) return
    mod.assertDiscordChannelsHaveIds({ channels: options.channels })
    const token = mod.getDiscordBotToken(tokenSrc())
    if (!token) {
      throw new Error(
        'Discord channels are configured but no bot token was found. Set DISCORD_BOT_TOKEN (or gateway.discordBotTokenEnv).',
      )
    }
  }

  const afterHubReady = async (io: GatewayIo): Promise<void> => {
    if (subscriptions.length === 0) return
    const token = mod.getDiscordBotToken(tokenSrc())
    if (!token) return
    const store = wrapDiscordStore(io.db)
    const hub = wrapDiscordHub(io.hub)
    runtime = await mod.startDiscordBot({
      subscriptions,
      store,
      hub,
      client: mod.createDiscordClient(),
      token,
      replyHandleTtlMs,
    })
  }

  const tryDispatchRoute = async (
    route: { kind?: string },
    action: string,
    args: Record<string, unknown>,
  ): Promise<DispatchResult | null> => {
    if (route.kind !== 'discord') return null
    const client = runtime?.client
    if (!client) {
      return { ok: false, error: 'discord client not running' }
    }
    try {
      const detail = await mod.executeDiscordDispatch(
        client,
        route as DiscordRouteData,
        action,
        args,
      )
      return { ok: true, detail }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return { ok: false, error: msg }
    }
  }

  return {
    prepare,
    afterHubReady,
    tryDispatchRoute,
  }
}
