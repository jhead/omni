/**
 * Shared Omnichannel MCP tools (stdio and Streamable HTTP) — omni_context, omni_dispatch,
 * and Claude Code channel notifications.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CapabilitySet, OmnichannelEvent } from '@omnibot/core'
import { z } from 'zod'

/** Claude Code channel extension — not in stock MCP SDK notification typings. */
export const CHANNEL_NOTIFY_METHOD = 'notifications/claude/channel' as const

export function eventToChannelParams(event: OmnichannelEvent): {
  content: string
  meta: Record<string, string>
} {
  const content =
    typeof event.payload === 'string'
      ? event.payload
      : JSON.stringify(event.payload, null, 2)
  return {
    content,
    meta: {
      event_id: event.id,
      channel_id: event.channelId,
      plugin: String(event.plugin),
      received_at: event.receivedAt,
    },
  }
}

const omniContextInput = z.object({})

const omniDispatchInput = z.object({
  channelId: z.string().describe('The omni channel ID to invoke the capability on'),
  capability: z.string().describe('The capability name (e.g. reply, react, send_message, fetch_history)'),
  args: z.record(z.unknown()).default({}).describe('Arguments for the capability (schema varies per capability — check omni_context)'),
  replyHandle: z.string().max(64).optional().describe('Required for capabilities where requiresReplyHandle is true'),
})

export interface OmniMcpBackend {
  getContext(): Promise<CapabilitySet[]>
  invoke(payload: {
    channelId: string
    capability: string
    args: Record<string, unknown>
    replyHandle?: string
  }): Promise<{ ok: true; data?: unknown } | { ok: false; error: string }>
  /** Deliver omnichannel events (same stream as IPC `type: event`). */
  subscribeChannelEvents(listener: (event: OmnichannelEvent) => void): () => void
}

export interface RegisterOmniMcpToolsResult {
  /** Call after the MCP transport is connected (stdio or HTTP session initialized). */
  notifyTransportReady: () => void
  dispose: () => void
}

/**
 * Registers `omni_context`, `omni_dispatch`, and wires channel events to `notifications/claude/channel`.
 */
export function registerOmniMcpTools(mcp: McpServer, backend: OmniMcpBackend): RegisterOmniMcpToolsResult {
  const pendingChannelEvents: OmnichannelEvent[] = []
  let channelNotifyReady = false

  const pushChannelEvent = (event: OmnichannelEvent) => {
    const { content, meta } = eventToChannelParams(event)
    void mcp.server.notification({
      method: CHANNEL_NOTIFY_METHOD,
      params: { content, meta },
    } as Parameters<typeof mcp.server.notification>[0])
  }

  let disposed = false
  const unsub = backend.subscribeChannelEvents(event => {
    if (!channelNotifyReady) {
      pendingChannelEvents.push(event)
      return
    }
    pushChannelEvent(event)
  })

  const registerTool = mcp.registerTool.bind(mcp) as (
    name: string,
    config: {
      title?: string
      description?: string
      inputSchema: z.ZodType<unknown>
    },
    handler: (args: unknown) => Promise<{
      content: Array<{ type: string; text: string }>
      isError?: boolean
    }>,
  ) => void

  registerTool(
    'omni_context',
    {
      title: 'Omnichannel context',
      description:
        'Call this first when handling omni events. Returns each channel\'s capabilities with arg schemas and replyHandle requirements.',
      inputSchema: omniContextInput,
    },
    async () => {
      const channels = await backend.getContext()
      return {
        content: [{ type: 'text', text: JSON.stringify({ channels }, null, 2) }],
      }
    },
  )

  registerTool(
    'omni_dispatch',
    {
      title: 'Omnichannel dispatch',
      description:
        'Invoke a channel capability by name. Check omni_context for available capabilities, their arg schemas, and whether replyHandle is required.',
      inputSchema: omniDispatchInput,
    },
    async (args: unknown) => {
      const v = omniDispatchInput.safeParse(args)
      if (!v.success) {
        return {
          content: [{ type: 'text', text: `Validation failed:\n${v.error.message}` }],
          isError: true,
        }
      }
      const r = await backend.invoke({
        channelId: v.data.channelId,
        capability: v.data.capability,
        args: v.data.args,
        replyHandle: v.data.replyHandle,
      })
      if (!r.ok) {
        return {
          content: [{ type: 'text', text: r.error ?? 'invoke failed' }],
          isError: true,
        }
      }
      const text = r.data !== undefined ? JSON.stringify(r.data, null, 2) : 'ok'
      return {
        content: [{ type: 'text', text }],
      }
    },
  )

  return {
    notifyTransportReady: () => {
      channelNotifyReady = true
      for (const e of pendingChannelEvents) pushChannelEvent(e)
      pendingChannelEvents.length = 0
    },
    dispose: () => {
      if (disposed) return
      disposed = true
      unsub()
    },
  }
}
