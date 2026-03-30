#!/usr/bin/env bun
/**
 * Omnichannel MCP adapter — stdio MCP with `omni_context` and `omni_dispatch`,
 * bridged to the Gateway over Unix domain sockets.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import type { OmnichannelEvent } from '@omnibot/core'
import { z } from 'zod'

import { OmniIpcClient } from './ipc-client.ts'
import { resolveIpcSocketPath } from './resolve-socket-path.ts'

/** Claude Code channel extension — not in stock MCP SDK notification typings. */
const CHANNEL_NOTIFY_METHOD = 'notifications/claude/channel' as const

function eventToChannelParams(event: OmnichannelEvent): {
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

async function main(): Promise<void> {
  const socketPath = resolveIpcSocketPath()
  const token = process.env.OMNI_IPC_TOKEN?.trim()

  const mcp = new McpServer(
    { name: 'omnichannel', version: '0.1.0' },
    {
      capabilities: {
        tools: {},
        experimental: {
          // https://code.claude.com/docs/en/channels-reference — registers channel listener
          'claude/channel': {},
        },
      },
      instructions:
        'Omnichannel events arrive as <channel source="omnichannel" event_id="..." channel_id="..." plugin="...">. ' +
        'Call `omni_context` first to discover each channel\'s capabilities with their arg schemas and whether a replyHandle is required. ' +
        'Then use `omni_dispatch` to invoke any capability — pass replyHandle from the event payload when the capability requires it.',
    },
  )

  const pendingChannelEvents: OmnichannelEvent[] = []
  let channelNotifyReady = false

  const pushChannelEvent = (event: OmnichannelEvent) => {
    const { content, meta } = eventToChannelParams(event)
    void mcp.server.notification({
      method: CHANNEL_NOTIFY_METHOD,
      params: { content, meta },
    } as Parameters<typeof mcp.server.notification>[0])
  }

  const ipc = new OmniIpcClient({
    socketPath,
    token,
    onEvent: event => {
      if (!channelNotifyReady) {
        pendingChannelEvents.push(event)
        return
      }
      pushChannelEvent(event)
    },
  })

  process.stderr.write(`omnichannel mcp: IPC socket ${socketPath}\n`)

  await ipc.connect()

  // McpServer's Zod generics explode TS inference; runtime still requires real Zod schemas.
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
      const channels = await ipc.getContext()
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
      const r = await ipc.invoke({
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

  const transport = new StdioServerTransport()
  await mcp.connect(transport)
  channelNotifyReady = true
  for (const e of pendingChannelEvents) pushChannelEvent(e)
  pendingChannelEvents.length = 0

  process.stderr.write(`omnichannel mcp: IPC ready (stdio MCP + claude/channel)\n`)
}

main().catch(err => {
  process.stderr.write(`omnichannel mcp: ${String(err)}\n`)
  process.exit(1)
})
