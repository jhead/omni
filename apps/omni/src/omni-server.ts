import { jsonResponse } from '@omnibot/gateway'

import type { AgentManager } from './agent-manager.ts'
import type { SpawnAgentOptions } from './agent-manager.ts'
import { createWsHandlers, type AgentWsData } from './ws-handler.ts'

import indexHtml from './web/index.html'
import terminalHtml from './web/terminal.html'

function checkBearer(req: Request, token: string): Response | null {
  const auth = req.headers.get('authorization')
  const expected = `Bearer ${token}`
  if (auth !== expected) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    })
  }
  return null
}

function parseSpawnBody(raw: unknown): SpawnAgentOptions {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return {}
  }
  const o = raw as Record<string, unknown>
  const id = typeof o.id === 'string' ? o.id : undefined
  let cmd: [string, ...string[]] | undefined
  if (Array.isArray(o.cmd) && o.cmd.length > 0 && o.cmd.every(x => typeof x === 'string')) {
    cmd = [o.cmd[0] as string, ...(o.cmd.slice(1) as string[])]
  }
  const cwd = typeof o.cwd === 'string' ? o.cwd : undefined
  const env =
    o.env !== null && typeof o.env === 'object' && !Array.isArray(o.env) ?
      (o.env as Record<string, string>)
    : undefined
  const cols = typeof o.cols === 'number' ? o.cols : undefined
  const rows = typeof o.rows === 'number' ? o.rows : undefined
  return { id, cmd, cwd, env, cols, rows }
}

export function startOmniServer(options: {
  hostname: string
  port: number
  bearerToken: string
  agentManager: AgentManager
}): ReturnType<typeof Bun.serve> {
  const { hostname, port, bearerToken, agentManager } = options
  const wsHandlers = createWsHandlers(agentManager)

  return Bun.serve({
    hostname,
    port,
    routes: {
      '/': indexHtml,
      '/terminal': terminalHtml,
    },
    fetch(req, server) {
      const url = new URL(req.url)
      const path = url.pathname

      if (path === '/health' && req.method === 'GET') {
        return jsonResponse({ ok: true })
      }

      const wsMatch = /^\/ws\/agents\/([^/]+)$/.exec(path)
      if (wsMatch && req.headers.get('upgrade')?.toLowerCase() === 'websocket') {
        const agentId = decodeURIComponent(wsMatch[1]!)
        const upgraded = server.upgrade(req, {
          data: { agentId } satisfies AgentWsData,
        })
        if (upgraded) {
          return undefined as unknown as Response
        }
        return new Response('WebSocket upgrade failed', { status: 500 })
      }

      if (path === '/api/agents' && req.method === 'GET') {
        const unauthorized = checkBearer(req, bearerToken)
        if (unauthorized) return unauthorized
        return jsonResponse({ agents: agentManager.list() })
      }

      if (path === '/api/agents' && req.method === 'POST') {
        const unauthorized = checkBearer(req, bearerToken)
        if (unauthorized) return unauthorized
        return (async () => {
          let body: unknown = {}
          try {
            const t = await req.text()
            if (t.trim()) body = JSON.parse(t) as unknown
          } catch {
            return jsonResponse({ error: 'invalid JSON body' }, 400)
          }
          try {
            const info = await agentManager.spawn(parseSpawnBody(body))
            return jsonResponse(info, 201)
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e)
            return jsonResponse({ error: msg }, 400)
          }
        })()
      }

      const one = /^\/api\/agents\/([^/]+)$/.exec(path)
      if (one) {
        const id = decodeURIComponent(one[1]!)
        if (req.method === 'GET') {
          const unauthorized = checkBearer(req, bearerToken)
          if (unauthorized) return unauthorized
          const a = agentManager.get(id)
          if (!a) return jsonResponse({ error: 'not found' }, 404)
          return jsonResponse(a)
        }
        if (req.method === 'DELETE') {
          const unauthorized = checkBearer(req, bearerToken)
          if (unauthorized) return unauthorized
          agentManager.kill(id)
          return jsonResponse({ ok: true })
        }
      }

      const input = /^\/api\/agents\/([^/]+)\/input$/.exec(path)
      if (input && req.method === 'POST') {
        const unauthorized = checkBearer(req, bearerToken)
        if (unauthorized) return unauthorized
        const id = decodeURIComponent(input[1]!)
        return (async () => {
          const text = await req.text()
          try {
            agentManager.sendInput(id, text)
            return jsonResponse({ ok: true })
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e)
            return jsonResponse({ error: msg }, 400)
          }
        })()
      }

      const resize = /^\/api\/agents\/([^/]+)\/resize$/.exec(path)
      if (resize && req.method === 'POST') {
        const unauthorized = checkBearer(req, bearerToken)
        if (unauthorized) return unauthorized
        const id = decodeURIComponent(resize[1]!)
        return (async () => {
          let body: { cols?: number; rows?: number }
          try {
            body = (await req.json()) as { cols?: number; rows?: number }
          } catch {
            return jsonResponse({ error: 'invalid JSON body' }, 400)
          }
          if (typeof body.cols !== 'number' || typeof body.rows !== 'number') {
            return jsonResponse({ error: 'cols and rows must be numbers' }, 400)
          }
          try {
            agentManager.resize(id, body.cols, body.rows)
            return jsonResponse({ ok: true })
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e)
            return jsonResponse({ error: msg }, 400)
          }
        })()
      }

      return new Response('Not Found\n', { status: 404 })
    },
    websocket: {
      open: wsHandlers.open,
      message: wsHandlers.message,
      close: wsHandlers.close,
    },
  })
}
