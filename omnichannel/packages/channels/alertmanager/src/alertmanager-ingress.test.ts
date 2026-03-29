import { describe, expect, test } from 'bun:test'

import type { OmnichannelEvent } from '@omnibot/core'

import {
  ALERTMANAGER_PATH_PREFIX,
  handleAlertmanagerPost,
  type AlertmanagerIngressContext,
} from './alertmanager-ingress.ts'

function minimalCtx(
  overrides: Partial<AlertmanagerIngressContext> = {},
): AlertmanagerIngressContext {
  return {
    ttlMs: 60_000,
    resolveChannel: () => ({ plugin: 'channel-alertmanager' }),
    hooks: {
      insertQueuedEvent: () => {},
      deleteQueuedEvent: () => {},
      getIpcClientCount: () => 0,
      broadcastEvent: () => {},
    },
    ...overrides,
  }
}

describe('handleAlertmanagerPost', () => {
  test('returns null for paths outside alertmanager prefix', async () => {
    const req = new Request('http://localhost/webhooks/x', { method: 'POST' })
    const r = await handleAlertmanagerPost(req, minimalCtx())
    expect(r).toBeNull()
  })

  test('returns 404 when channel is not channel-alertmanager', async () => {
    const req = new Request(
      `http://localhost${ALERTMANAGER_PATH_PREFIX}x`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ receiver: 'r', status: 'firing', alerts: [] }),
      },
    )
    const r = await handleAlertmanagerPost(
      req,
      minimalCtx({
        resolveChannel: () => ({ plugin: 'channel-webhook' }),
      }),
    )
    expect(r).not.toBeNull()
    expect(r!.status).toBe(404)
  })

  test('enqueues normalized event', async () => {
    let seen: OmnichannelEvent | undefined
    const req = new Request(
      `http://localhost${ALERTMANAGER_PATH_PREFIX}alerts`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          receiver: 'omni',
          status: 'firing',
          alerts: [],
        }),
      },
    )
    const r = await handleAlertmanagerPost(
      req,
      minimalCtx({
        hooks: {
          insertQueuedEvent(ev) {
            seen = ev
          },
          deleteQueuedEvent: () => {},
          getIpcClientCount: () => 0,
          broadcastEvent: () => {},
        },
      }),
    )
    expect(r!.ok).toBe(true)
    expect(seen?.channelId).toBe('alerts')
    expect(seen?.plugin).toBe('channel-alertmanager')
    expect(
      seen &&
        typeof seen.payload === 'object' &&
        seen.payload !== null &&
        'kind' in seen.payload &&
        (seen.payload as { kind: string }).kind,
    ).toBe('alertmanager')
  })
})
