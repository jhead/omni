/**
 * Streamable HTTP MCP on the gateway HTTP port — same tools as stdio, in-process via {@link IpcHub}.
 */

import { randomUUID } from 'node:crypto'

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js'

import type { OmniMcpHubLike } from './hub-types.ts'
import { registerOmniMcpTools, type OmniMcpBackend } from './omni-mcp-core.ts'

function createHubBackend(hub: OmniMcpHubLike): OmniMcpBackend {
  return {
    getContext: async () => hub.getCapabilitiesSnapshot(),
    invoke: async p => {
      const id = randomUUID()
      return hub.invokeInProcess({
        id,
        channelId: p.channelId,
        capability: p.capability,
        args: p.args,
        replyHandle: p.replyHandle,
      })
    },
    subscribeChannelEvents: cb => hub.subscribeEvents(cb),
  }
}

export type OmniMcpHttpSession = {
  mcp: McpServer
  notifyTransportReady: () => void
  dispose: () => void
}

/**
 * Create a new MCP server + tool registration for one HTTP session. Caller connects transport, then calls `notifyTransportReady`.
 */
export function createOmniMcpHttpSession(hub: OmniMcpHubLike): OmniMcpHttpSession {
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
  const backend = createHubBackend(hub)
  const { notifyTransportReady, dispose } = registerOmniMcpTools(mcp, backend)
  return { mcp, notifyTransportReady, dispose }
}

export type OmniMcpHttpAutoSubscribe = {
  channelId: string
  topic: string
}

/**
 * Streamable HTTP MCP: POST (initialize + JSON-RPC), GET (SSE), DELETE (session end).
 */
export function createOmniMcpHttpFetchHandler(ctx: {
  mcpPath: string
  hub: OmniMcpHubLike
  /** When set, invokes agent-bus `subscribe` after each session is transport-ready (e.g. shared peer topic). */
  autoSubscribe?: OmniMcpHttpAutoSubscribe | null
}): (req: Request) => Promise<Response> {
  const transports = new Map<string, WebStandardStreamableHTTPServerTransport>()
  const sessions = new Map<string, OmniMcpHttpSession>()

  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url)
    if (url.pathname !== ctx.mcpPath) {
      return new Response('Not Found\n', { status: 404 })
    }

    const sessionHeader = req.headers.get('mcp-session-id') ?? undefined

    if (req.method === 'POST') {
      const text = await req.text()
      let parsedBody: unknown
      try {
        parsedBody = text ? JSON.parse(text) : undefined
      } catch {
        return new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            error: { code: -32700, message: 'Parse error' },
            id: null,
          }),
          { status: 400, headers: { 'content-type': 'application/json' } },
        )
      }

      if (sessionHeader && transports.has(sessionHeader)) {
        const tr = transports.get(sessionHeader)!
        const reqForTransport = new Request(req.url, {
          method: req.method,
          headers: req.headers,
          body: text,
        })
        return tr.handleRequest(reqForTransport, { parsedBody })
      }

      if (!sessionHeader && isInitializeRequest(parsedBody)) {
        const { mcp, notifyTransportReady, dispose } = createOmniMcpHttpSession(ctx.hub)
        const transport = new WebStandardStreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: async sid => {
            transports.set(sid, transport)
            if (sid) sessions.set(sid, { mcp, notifyTransportReady, dispose })
            notifyTransportReady()
            const sub = ctx.autoSubscribe
            if (sub) {
              const r = await ctx.hub.invokeInProcess({
                id: randomUUID(),
                channelId: sub.channelId,
                capability: 'subscribe',
                args: { topic: sub.topic },
              })
              if (!r.ok) {
                process.stderr.write(
                  `omnichannel mcp http: auto-subscribe failed (${sub.channelId} topic=${sub.topic}): ${r.error}\n`,
                )
              }
            }
          },
          onsessionclosed: async sid => {
            transports.delete(sid)
            const s = sid ? sessions.get(sid) : undefined
            if (sid) sessions.delete(sid)
            s?.dispose()
            try {
              await mcp.close()
            } catch (e) {
              process.stderr.write(`omnichannel mcp http: close session ${sid}: ${String(e)}\n`)
            }
          },
        })
        transport.onclose = () => {
          const sid = transport.sessionId
          if (sid && transports.has(sid)) {
            transports.delete(sid)
          }
          const s = sid ? sessions.get(sid) : undefined
          if (sid) sessions.delete(sid)
          s?.dispose()
        }
        await mcp.connect(transport)
        const reqForTransport = new Request(req.url, {
          method: req.method,
          headers: req.headers,
          body: text,
        })
        return transport.handleRequest(reqForTransport, { parsedBody })
      }

      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          error: {
            code: -32000,
            message:
              'Bad Request: expected initialize without session, or a valid Mcp-Session-Id',
          },
          id: null,
        }),
        { status: 400, headers: { 'content-type': 'application/json' } },
      )
    }

    if (req.method === 'GET' || req.method === 'DELETE') {
      if (!sessionHeader || !transports.has(sessionHeader)) {
        return new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            error: { code: -32001, message: 'Session not found' },
            id: null,
          }),
          { status: 404, headers: { 'content-type': 'application/json' } },
        )
      }
      const tr = transports.get(sessionHeader)!
      return tr.handleRequest(req)
    }

    return new Response(
      JSON.stringify({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Method not allowed' },
        id: null,
      }),
      { status: 405, headers: { 'content-type': 'application/json' } },
    )
  }
}
