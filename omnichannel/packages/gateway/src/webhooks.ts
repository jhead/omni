import type { Database } from 'bun:sqlite'

import type { OmnichannelEvent } from '@omnichannel/core'

import type { LoadedConfig } from './config.ts'
import {
  deleteQueuedEvent,
  insertQueuedEvent,
} from './db.ts'
import { jsonResponse } from './http-util.ts'
import type { IpcHub } from './ipc.ts'

export interface WebhookIngressContext {
  config: LoadedConfig
  db: Database
  hub: IpcHub
  ttlMs: number
}

export async function handleWebhookPost(
  req: Request,
  ctx: WebhookIngressContext,
): Promise<Response> {
  const url = new URL(req.url)
  const prefix = '/webhooks/'
  if (!url.pathname.startsWith(prefix)) {
    return jsonResponse({ error: 'not found' }, 404)
  }

  const channelId = decodeURIComponent(url.pathname.slice(prefix.length))
  if (!channelId || channelId.includes('/')) {
    return jsonResponse({ error: 'invalid channel' }, 400)
  }

  if (!ctx.config.channels[channelId]) {
    return jsonResponse({ error: `unknown channel: ${channelId}` }, 404)
  }

  const plugin = ctx.config.channels[channelId].plugin
  let body: unknown
  const ct = req.headers.get('content-type') ?? ''
  if (ct.includes('application/json')) {
    try {
      body = await req.json()
    } catch {
      return jsonResponse({ error: 'invalid JSON body' }, 400)
    }
  } else {
    body = await req.text()
  }

  const event: OmnichannelEvent = {
    id: crypto.randomUUID(),
    channelId,
    plugin,
    receivedAt: new Date().toISOString(),
    payload: body,
  }

  const expiresAt = Date.now() + ctx.ttlMs
  insertQueuedEvent(ctx.db, event, expiresAt)

  if (ctx.hub.clientCount > 0) {
    ctx.hub.broadcast({ type: 'event', event })
    deleteQueuedEvent(ctx.db, event.id)
  }

  return jsonResponse({ ok: true, eventId: event.id })
}
