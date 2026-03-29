/**
 * HTTP `POST /alertmanager/:channelId` — Alertmanager webhook ingress.
 */

import type { OmnichannelEvent, OmnichannelPluginId } from '@omnibot/core'

import { normalizeAlertmanagerWebhook } from './normalize.ts'

export const ALERTMANAGER_PATH_PREFIX = '/alertmanager/' as const

export interface AlertmanagerIngressHooks {
  insertQueuedEvent(event: OmnichannelEvent, expiresAt: number): void
  deleteQueuedEvent(id: string): void
  getIpcClientCount(): number
  broadcastEvent(event: OmnichannelEvent): void
}

export interface ResolvedAlertmanagerChannel {
  plugin: OmnichannelPluginId
  /** When set, `Authorization: Bearer <token>` is required. */
  bearerToken?: string
}

export interface AlertmanagerIngressContext {
  ttlMs: number
  resolveChannel(channelId: string): ResolvedAlertmanagerChannel | null
  hooks: AlertmanagerIngressHooks
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

function bearerMatches(req: Request, expected: string | undefined): boolean {
  if (expected === undefined) return true
  const auth = req.headers.get('authorization')?.trim() ?? ''
  return auth === `Bearer ${expected}`
}

/**
 * Handles POST for `/alertmanager/…` paths. Returns `null` to delegate to other plugins.
 */
export async function handleAlertmanagerPost(
  req: Request,
  ctx: AlertmanagerIngressContext,
): Promise<Response | null> {
  const url = new URL(req.url)
  if (!url.pathname.startsWith(ALERTMANAGER_PATH_PREFIX)) {
    return null
  }

  const channelId = decodeURIComponent(
    url.pathname.slice(ALERTMANAGER_PATH_PREFIX.length),
  )
  if (!channelId || channelId.includes('/')) {
    return jsonResponse({ error: 'invalid channel' }, 400)
  }

  const resolved = ctx.resolveChannel(channelId)
  if (!resolved) {
    return jsonResponse({ error: `unknown channel: ${channelId}` }, 404)
  }
  if (resolved.plugin !== 'channel-alertmanager') {
    return jsonResponse(
      { error: `channel ${channelId} is not plugin channel-alertmanager` },
      404,
    )
  }

  if (!bearerMatches(req, resolved.bearerToken)) {
    return jsonResponse({ error: 'unauthorized' }, 401)
  }

  const ct = req.headers.get('content-type') ?? ''
  let body: unknown
  if (ct.includes('application/json')) {
    try {
      body = await req.json()
    } catch {
      return jsonResponse({ error: 'invalid JSON body' }, 400)
    }
  } else {
    return jsonResponse(
      { error: 'expected application/json body' },
      415,
    )
  }

  const normalized = normalizeAlertmanagerWebhook(body)
  if (!normalized.ok) {
    return jsonResponse({ error: normalized.error }, 400)
  }

  const event: OmnichannelEvent = {
    id: crypto.randomUUID(),
    channelId,
    plugin: 'channel-alertmanager',
    receivedAt: new Date().toISOString(),
    payload: normalized.value,
  }

  const expiresAt = Date.now() + ctx.ttlMs
  ctx.hooks.insertQueuedEvent(event, expiresAt)

  if (ctx.hooks.getIpcClientCount() > 0) {
    ctx.hooks.broadcastEvent(event)
    ctx.hooks.deleteQueuedEvent(event.id)
  }

  return jsonResponse({ ok: true, eventId: event.id })
}
