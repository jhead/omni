import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { Hono } from 'hono'

import type { AgentManager } from './agent-manager.ts'
import type { SpawnAgentOptions } from './agent-manager.ts'
import { DEFAULT_AGENT_TEMPLATE_ID } from './agent-persistence.ts'
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
  const templateId = typeof o.templateId === 'string' ? o.templateId : undefined
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
  return { id, templateId, cmd, cwd, env, cols, rows }
}

const TEMPLATE_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/

function parseTemplateCreateBody(raw: unknown): {
  id: string
  name: string
  templateDir?: string | null
  claudeMd?: string | null
  settingsJson?: Record<string, unknown> | null
  defaultCmd?: [string, ...string[]] | null
  defaultCols?: number | null
  defaultRows?: number | null
} {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('body must be a JSON object')
  }
  const o = raw as Record<string, unknown>
  const id = typeof o.id === 'string' ? o.id.trim() : ''
  if (!id || !TEMPLATE_ID_RE.test(id)) {
    throw new Error('id must match /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/')
  }
  if (id === DEFAULT_AGENT_TEMPLATE_ID) {
    throw new Error(`id "${DEFAULT_AGENT_TEMPLATE_ID}" is reserved`)
  }
  const name = typeof o.name === 'string' ? o.name.trim() : ''
  if (!name) throw new Error('name is required')
  const templateDir =
    o.templateDir === null || o.templateDir === undefined ?
      undefined
    : typeof o.templateDir === 'string' ?
      o.templateDir
    : (() => {
        throw new Error('templateDir must be a string or null')
      })()
  const claudeMd =
    o.claudeMd === null || o.claudeMd === undefined ?
      undefined
    : typeof o.claudeMd === 'string' ?
      o.claudeMd
    : (() => {
        throw new Error('claudeMd must be a string or null')
      })()
  let settingsJson: Record<string, unknown> | null | undefined
  if (o.settingsJson === null) {
    settingsJson = null
  } else if (o.settingsJson === undefined) {
    settingsJson = undefined
  } else if (typeof o.settingsJson === 'object' && !Array.isArray(o.settingsJson)) {
    settingsJson = o.settingsJson as Record<string, unknown>
  } else {
    throw new Error('settingsJson must be a JSON object or null')
  }
  let defaultCmd: [string, ...string[]] | null | undefined
  if (o.defaultCmd === null) {
    defaultCmd = null
  } else if (o.defaultCmd === undefined) {
    defaultCmd = undefined
  } else if (Array.isArray(o.defaultCmd) && o.defaultCmd.length > 0 && o.defaultCmd.every(x => typeof x === 'string')) {
    defaultCmd = [o.defaultCmd[0] as string, ...(o.defaultCmd.slice(1) as string[])]
  } else {
    throw new Error('defaultCmd must be a non-empty string array or null')
  }
  let defaultCols: number | null | undefined
  if (o.defaultCols === undefined) {
    defaultCols = undefined
  } else if (o.defaultCols === null) {
    defaultCols = null
  } else if (typeof o.defaultCols === 'number' && Number.isFinite(o.defaultCols)) {
    defaultCols = o.defaultCols
  } else {
    throw new Error('defaultCols must be a number or null')
  }
  let defaultRows: number | null | undefined
  if (o.defaultRows === undefined) {
    defaultRows = undefined
  } else if (o.defaultRows === null) {
    defaultRows = null
  } else if (typeof o.defaultRows === 'number' && Number.isFinite(o.defaultRows)) {
    defaultRows = o.defaultRows
  } else {
    throw new Error('defaultRows must be a number or null')
  }
  return {
    id,
    name,
    templateDir,
    claudeMd,
    settingsJson,
    defaultCmd,
    defaultCols,
    defaultRows,
  }
}

type AgentTemplatePatch = Partial<{
  name: string
  templateDir: string | null
  claudeMd: string | null
  settingsJson: Record<string, unknown> | null
  defaultCmd: [string, ...string[]] | null
  defaultCols: number | null
  defaultRows: number | null
}>

function parseTemplatePatchBody(raw: unknown): AgentTemplatePatch {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('body must be a JSON object')
  }
  const o = raw as Record<string, unknown>
  const patch: AgentTemplatePatch = {}
  if ('name' in o) {
    if (typeof o.name !== 'string' || !o.name.trim()) throw new Error('name must be a non-empty string')
    patch.name = o.name.trim()
  }
  if ('templateDir' in o) {
    if (o.templateDir !== null && typeof o.templateDir !== 'string') {
      throw new Error('templateDir must be a string or null')
    }
    patch.templateDir = o.templateDir === null ? null : o.templateDir
  }
  if ('claudeMd' in o) {
    if (o.claudeMd !== null && typeof o.claudeMd !== 'string') {
      throw new Error('claudeMd must be a string or null')
    }
    patch.claudeMd = o.claudeMd === null ? null : o.claudeMd
  }
  if ('settingsJson' in o) {
    if (o.settingsJson === null) {
      patch.settingsJson = null
    } else if (typeof o.settingsJson === 'object' && !Array.isArray(o.settingsJson)) {
      patch.settingsJson = o.settingsJson as Record<string, unknown>
    } else {
      throw new Error('settingsJson must be a JSON object or null')
    }
  }
  if ('defaultCmd' in o) {
    if (o.defaultCmd === null) {
      patch.defaultCmd = null
    } else if (
      Array.isArray(o.defaultCmd) &&
      o.defaultCmd.length > 0 &&
      o.defaultCmd.every(x => typeof x === 'string')
    ) {
      patch.defaultCmd = [o.defaultCmd[0] as string, ...(o.defaultCmd.slice(1) as string[])]
    } else {
      throw new Error('defaultCmd must be a non-empty string array or null')
    }
  }
  if ('defaultCols' in o) {
    if (o.defaultCols === null) {
      patch.defaultCols = null
    } else if (typeof o.defaultCols === 'number' && Number.isFinite(o.defaultCols)) {
      patch.defaultCols = o.defaultCols
    } else {
      throw new Error('defaultCols must be a number or null')
    }
  }
  if ('defaultRows' in o) {
    if (o.defaultRows === null) {
      patch.defaultRows = null
    } else if (typeof o.defaultRows === 'number' && Number.isFinite(o.defaultRows)) {
      patch.defaultRows = o.defaultRows
    } else {
      throw new Error('defaultRows must be a number or null')
    }
  }
  return patch
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

  api.get('/agent-templates', c => {
    return c.json({ templates: agentManager.getPersistence().listTemplates() })
  })

  api.post('/agent-templates', async c => {
    let body: unknown = {}
    try {
      const t = await c.req.text()
      if (t.trim()) body = JSON.parse(t) as unknown
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400)
    }
    try {
      const row = parseTemplateCreateBody(body)
      agentManager.getPersistence().insertTemplate(row)
      const created = agentManager.getPersistence().getTemplate(row.id)
      return c.json(created, 201)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return c.json({ error: msg }, 400)
    }
  })

  api.get('/agent-templates/:id', c => {
    const id = c.req.param('id')
    const t = agentManager.getPersistence().getTemplate(id)
    if (!t) return c.json({ error: 'not found' }, 404)
    return c.json(t)
  })

  api.patch('/agent-templates/:id', async c => {
    const id = c.req.param('id')
    let body: unknown = {}
    try {
      const t = await c.req.text()
      if (t.trim()) body = JSON.parse(t) as unknown
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400)
    }
    try {
      const patch = parseTemplatePatchBody(body)
      if (Object.keys(patch).length === 0) {
        return c.json({ error: 'empty patch' }, 400)
      }
      agentManager.getPersistence().updateTemplate(id, patch)
      const updated = agentManager.getPersistence().getTemplate(id)
      return c.json(updated)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      const status = msg.includes('unknown template') ? 404 : 400
      return c.json({ error: msg }, status)
    }
  })

  api.delete('/agent-templates/:id', c => {
    const id = c.req.param('id')
    try {
      agentManager.getPersistence().deleteTemplate(id)
      return c.json({ ok: true })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      const status =
        msg.includes('cannot delete system') ? 403 : msg.includes('unknown template') ? 404 : 400
      return c.json({ error: msg }, status)
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
