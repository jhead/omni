#!/usr/bin/env bun
/**
 * Omnichannel MCP adapter — stdio MCP with `omni_context` and `omni_dispatch`,
 * bridged to the Gateway over Unix domain sockets.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { validateOmniDispatch } from '@omnichannel/core'
import { z } from 'zod'

import { OmniIpcClient } from './ipc-client.ts'
import { resolveIpcSocketPath } from './resolve-socket-path.ts'

const omniContextInput = z.object({})

const omniDispatchInput = z.object({
  replyHandle: z.string().max(64),
  action: z.enum(['reply', 'react', 'ack', 'resolve', 'noop']),
  args: z.record(z.unknown()),
})

async function main(): Promise<void> {
  const socketPath = resolveIpcSocketPath()
  const token = process.env.OMNI_IPC_TOKEN?.trim()

  const mcp = new McpServer(
    { name: 'omnichannel', version: '0.1.0' },
    { capabilities: { tools: {} } },
  )

  const ipc = new OmniIpcClient({
    socketPath,
    token,
    onEvent: event => {
      void mcp.sendLoggingMessage({
        level: 'info',
        logger: 'omnichannel',
        data: { omnichannel: 'event', event },
      })
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
        'Read-only view of configured channels and capabilities (ingress/egress, allowed actions).',
      inputSchema: omniContextInput,
    },
    async () => {
      const channels = await ipc.getContext()
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ channels }, null, 2),
          },
        ],
      }
    },
  )

  registerTool(
    'omni_dispatch',
    {
      title: 'Omnichannel dispatch',
      description:
        'Single outbound verb: reply, react, ack, resolve, or noop. Core validates payload; platform egress is phased by channel type.',
      inputSchema: omniDispatchInput,
    },
    async (args: unknown) => {
      const v = validateOmniDispatch(args)
      if (!v.ok) {
        return {
          content: [
            {
              type: 'text',
              text: `Validation failed:\n${v.errors.join('\n')}`,
            },
          ],
          isError: true,
        }
      }
      return {
        content: [
          {
            type: 'text',
            text:
              'Payload is valid. Phase 1 generic_webhook is ingress-only; outbound delivery and reply routing arrive in later phases. ' +
              `Validated action=${v.value.action} replyHandle=${v.value.replyHandle}`,
          },
        ],
      }
    },
  )

  const transport = new StdioServerTransport()
  await mcp.connect(transport)

  process.stderr.write(`omnichannel mcp: IPC ready (stdio MCP)\n`)
}

main().catch(err => {
  process.stderr.write(`omnichannel mcp: ${String(err)}\n`)
  process.exit(1)
})
