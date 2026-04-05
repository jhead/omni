#!/usr/bin/env bun
/**
 * Omnichannel MCP adapter — stdio MCP with `omni_context` and `omni_dispatch`,
 * bridged to the Gateway over Unix domain sockets.
 */

import type { OmnichannelEvent } from '@omnibot/core'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'

import { OmniIpcClient } from './ipc-client.ts'
import { registerOmniMcpTools, type OmniMcpBackend } from './omni-mcp-core.ts'
import { resolveIpcSocketPath } from './resolve-socket-path.ts'

function createIpcClientBackend(
  client: OmniIpcClient,
  subscribeDemux: (cb: (e: OmnichannelEvent) => void) => () => void,
): OmniMcpBackend {
  return {
    getContext: () => client.getContext(),
    invoke: async p => {
      const r = await client.invoke(p)
      return r.ok ?
          { ok: true, data: r.data }
        : { ok: false, error: r.error ?? 'invoke failed' }
    },
    subscribeChannelEvents: subscribeDemux,
  }
}

async function main(): Promise<void> {
  const socketPath = resolveIpcSocketPath()
  const token = process.env.OMNI_IPC_TOKEN?.trim()

  const subs = new Set<(e: OmnichannelEvent) => void>()
  const ipc = new OmniIpcClient({
    socketPath,
    token,
    onEvent: e => {
      for (const fn of subs) fn(e)
    },
  })

  const mcp = new McpServer(
    { name: 'omnichannel', version: '0.1.0' },
    {
      capabilities: {
        tools: {},
        experimental: {
          'claude/channel': {},
        },
      },
      instructions:
        'Omnichannel events arrive as <channel source="omnichannel" event_id="..." channel_id="..." plugin="...">. ' +
        'Call `omni_context` first to discover each channel\'s capabilities with their arg schemas and whether a replyHandle is required. ' +
        'Then use `omni_dispatch` to invoke any capability — pass replyHandle from the event payload when the capability requires it.',
    },
  )

  const backend = createIpcClientBackend(ipc, cb => {
    subs.add(cb)
    return () => subs.delete(cb)
  })
  const { notifyTransportReady } = registerOmniMcpTools(mcp, backend)

  process.stderr.write(`omnichannel mcp: IPC socket ${socketPath}\n`)

  await ipc.connect()

  const transport = new StdioServerTransport()
  await mcp.connect(transport)
  notifyTransportReady()

  process.stderr.write(`omnichannel mcp: IPC ready (stdio MCP + claude/channel)\n`)
}

main().catch(err => {
  process.stderr.write(`omnichannel mcp: ${String(err)}\n`)
  process.exit(1)
})
