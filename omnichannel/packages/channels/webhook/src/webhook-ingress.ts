/**
 * HTTP `/webhooks/:channelId` ingress — used by {@link createGatewayPluginHost}'s `handleHttp`.
 */

import type { OmnichannelEvent, OmnichannelPluginId } from '@omnibot/core'

/** Default URL prefix; callers may wrap or replace routing later for custom paths. */
export const WEBHOOK_PATH_PREFIX = '/webhooks/' as const

export interface WebhookIngressHooks {
  insertQueuedEvent(event: OmnichannelEvent, expiresAt: number): void
  deleteQueuedEvent(id: string): void
  getIpcClientCount(): number
  broadcastEvent(event: OmnichannelEvent): void
}

export interface WebhookIngressContext {
  ttlMs: number
  resolveChannel(channelId: string): { plugin: OmnichannelPluginId } | null
  hooks: WebhookIngressHooks
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

/**
 * Handles POST body ingestion for `/webhooks/…` paths.
 * Returns `null` if the request URL is not under this channel's HTTP route (delegate to other plugins).
 */
export async function handleWebhookPost(
  req: Request,
  ctx: WebhookIngressContext,
): Promise<Response | null> {
  const url = new URL(req.url)
  if (!url.pathname.startsWith(WEBHOOK_PATH_PREFIX)) {
    return null
  }

  const channelId = decodeURIComponent(
    url.pathname.slice(WEBHOOK_PATH_PREFIX.length),
  )
  if (!channelId || channelId.includes('/')) {
    return jsonResponse({ error: 'invalid channel' }, 400)
  }

  const resolved = ctx.resolveChannel(channelId)
  if (!resolved) {
    return jsonResponse({ error: `unknown channel: ${channelId}` }, 404)
  }

  const { plugin } = resolved
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
  ctx.hooks.insertQueuedEvent(event, expiresAt)

  if (ctx.hooks.getIpcClientCount() > 0) {
    ctx.hooks.broadcastEvent(event)
    ctx.hooks.deleteQueuedEvent(event.id)
  }

  return jsonResponse({ ok: true, eventId: event.id })
}
