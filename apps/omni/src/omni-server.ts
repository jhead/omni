import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { Hono } from 'hono'

import type { AgentManager } from './agent-manager.ts'
import type { SpawnAgentOptions } from './agent-manager.ts'
import { createWsHandlers, type AgentWsData } from './ws-handler.ts'

/** Bun’s HTML import `.index` is the file path, not markup; load text explicitly. */
const indexHtml = readFileSync(
  fileURLToPath(new URL('./web/index.html', import.meta.url)),
  'utf-8',
)
const terminalHtml = readFileSync(
  fileURLToPath(new URL('./web/terminal.html', import.meta.url)),
  'utf-8',
)

async function bundleWebEntry(relativeToThisFile: string): Promise<string> {
  const entryPath = fileURLToPath(new URL(relativeToThisFile, import.meta.url))
  const result = await Bun.build({
    entrypoints: [entryPath],
    target: 'browser',
    format: 'esm',
  })
  if (!result.success) {
    const detail = result.logs.map(l => l.message).join('\n')
    throw new Error(`web bundle failed (${relativeToThisFile}):\n${detail}`)
  }
  const first = result.outputs[0]
  if (!first) {
    throw new Error(`web bundle produced no output (${relativeToThisFile})`)
  }
  return first.text()
}

const dashboardJs = await bundleWebEntry('./web/dashboard.ts')
const terminalJs = await bundleWebEntry('./web/terminal.ts')

const jsHeaders = {
  'content-type': 'application/javascript; charset=utf-8',
} as const

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

/** HTTP routes only (WebSocket upgrades are handled in {@link startOmniServer}). */
export function createOmniApp(agentManager: AgentManager, bearerToken: string): Hono {
  const app = new Hono()

  app.get('/health', c => c.json({ ok: true }))

  app.get('/', c => c.html(indexHtml))
  app.get('/terminal', c => c.html(terminalHtml))

  app.get('/dashboard.ts', c => c.body(dashboardJs, 200, jsHeaders))
  app.get('/terminal.ts', c => c.body(terminalJs, 200, jsHeaders))

  const api = new Hono()

  api.use(async (c, next) => {
    const expected = `Bearer ${bearerToken}`
    if (c.req.header('authorization') !== expected) {
      return c.json({ error: 'Unauthorized' }, 401)
    }
    await next()
  })

  api.get('/agents', c => c.json({ agents: agentManager.list() }))

  api.post('/agents', async c => {
    let body: unknown = {}
    try {
      const t = await c.req.text()
      if (t.trim()) body = JSON.parse(t) as unknown
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400)
    }
    try {
      const info = await agentManager.spawn(parseSpawnBody(body))
      return c.json(info, 201)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return c.json({ error: msg }, 400)
    }
  })

  api.get('/agents/:id', c => {
    const id = c.req.param('id')
    const a = agentManager.get(id)
    if (!a) return c.json({ error: 'not found' }, 404)
    return c.json(a)
  })

  api.delete('/agents/:id', c => {
    const id = c.req.param('id')
    agentManager.kill(id)
    return c.json({ ok: true })
  })

  api.post('/agents/:id/restart', async c => {
    const id = c.req.param('id')
    try {
      const info = await agentManager.restart(id)
      return c.json(info, 200)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return c.json({ error: msg }, 400)
    }
  })

  api.post('/agents/:id/input', async c => {
    const id = c.req.param('id')
    const text = await c.req.text()
    try {
      agentManager.sendInput(id, text)
      return c.json({ ok: true })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return c.json({ error: msg }, 400)
    }
  })

  api.post('/agents/:id/resize', async c => {
    const id = c.req.param('id')
    let body: { cols?: number; rows?: number }
    try {
      body = (await c.req.json()) as { cols?: number; rows?: number }
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400)
    }
    if (typeof body.cols !== 'number' || typeof body.rows !== 'number') {
      return c.json({ error: 'cols and rows must be numbers' }, 400)
    }
    try {
      agentManager.resize(id, body.cols, body.rows)
      return c.json({ ok: true })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return c.json({ error: msg }, 400)
    }
  })

  app.route('/api', api)

  return app
}

export function startOmniServer(options: {
  hostname: string
  port: number
  bearerToken: string
  agentManager: AgentManager
}): ReturnType<typeof Bun.serve> {
  const { hostname, port, bearerToken, agentManager } = options
  const wsHandlers = createWsHandlers(agentManager)
  const app = createOmniApp(agentManager, bearerToken)

  return Bun.serve({
    hostname,
    port,
    fetch(req, server) {
      const url = new URL(req.url)
      const path = url.pathname

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

      return app.fetch(req)
    },
    websocket: {
      open: wsHandlers.open,
      message: wsHandlers.message,
      close: wsHandlers.close,
    },
  })
}
