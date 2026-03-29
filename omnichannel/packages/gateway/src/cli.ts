#!/usr/bin/env bun
/**
 * CLI entry: loads `@omnibot/<plugin>` for each channel `plugin` id from `omni.yaml` (dynamic import).
 */

import {
  getCapabilitySetsForChannels,
  validateOmniDispatch,
} from '@omnibot/core'

import {
  getReplyHandleRow,
  jsonResponse,
  loadGatewayConfig,
  startGateway,
  type CreateGatewayPluginHost,
  type GatewayIo,
  type GatewayPluginHost,
  type GatewayPluginHostContext,
  type GatewayPluginHttpContext,
} from './index.ts'

/** Must match workspace package names under `@omnibot/`. */
const CHANNEL_PLUGIN_ID_RE = /^channel-[a-z0-9-]+$/

function uniqueChannelPluginIds(
  channels: Record<string, { plugin: string }>,
): string[] {
  return [...new Set(Object.values(channels).map(c => c.plugin))]
}

function assertValidChannelPluginId(id: string): void {
  if (!CHANNEL_PLUGIN_ID_RE.test(id)) {
    throw new Error(
      `Invalid channel plugin "${id}". Use the package name without scope (e.g. channel-webhook, channel-discord).`,
    )
  }
}

async function importChannelModules(
  pluginIds: string[],
): Promise<Map<string, Record<string, unknown>>> {
  const map = new Map<string, Record<string, unknown>>()
  await Promise.all(
    pluginIds.map(async id => {
      assertValidChannelPluginId(id)
      const specifier = `@omnibot/${id}`
      try {
        const mod = (await import(specifier)) as Record<string, unknown>
        map.set(id, mod)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        throw new Error(`Failed to load channel package ${specifier}: ${msg}`)
      }
    }),
  )
  return map
}

async function main(): Promise<void> {
  const cfg = loadGatewayConfig(process.argv[2])

  const pluginIds = uniqueChannelPluginIds(cfg.channels)
  const channelMods = await importChannelModules(pluginIds)

  const ttlSeconds = cfg.gateway.queueTtlSeconds ?? 86_400
  const ttlMs = ttlSeconds * 1000
  const replyHandleTtlMs =
    (cfg.gateway.replyHandleTtlSeconds ?? 604_800) * 1000

  const ctx: GatewayPluginHostContext = {
    channels: cfg.channels,
    document: cfg.document,
    replyHandleTtlMs,
  }

  const plugins: GatewayPluginHost[] = []
  for (const id of [...pluginIds].sort()) {
    const mod = channelMods.get(id)
    if (!mod) continue
    const factory = mod.createGatewayPluginHost as CreateGatewayPluginHost | undefined
    if (typeof factory === 'function') {
      plugins.push(factory(mod, ctx))
    }
  }

  plugins.forEach(p => p.prepare())

  const httpCtx: GatewayPluginHttpContext = { ttlMs, config: cfg }

  await startGateway({
    config: cfg,
    getCapabilities: () => getCapabilitySetsForChannels(cfg.channels),
    onDispatch: async (d, { db }) => {
      const v = validateOmniDispatch({
        replyHandle: d.replyHandle,
        action: d.action,
        args: d.args,
      })
      if (!v.ok) {
        return { ok: false, error: v.errors.join('; ') }
      }
      const row = getReplyHandleRow(db, v.value.replyHandle)
      if (!row) {
        return { ok: false, error: 'unknown or expired reply handle' }
      }
      let route: { kind?: string }
      try {
        route = JSON.parse(row.route_json) as { kind?: string }
      } catch {
        return { ok: false, error: 'invalid route data' }
      }
      for (const p of plugins) {
        const r = await p.tryDispatchRoute(route, v.value.action, v.value.args)
        if (r != null) return r
      }
      return { ok: false, error: 'no egress for this route' }
    },
    fetch: (req, io) => dispatchPluginHttp(req, io, plugins, httpCtx),
    afterHubReady: async io => {
      for (const p of plugins) await p.afterHubReady(io)
    },
  })
}

function dispatchPluginHttp(
  req: Request,
  io: GatewayIo,
  plugins: GatewayPluginHost[],
  httpCtx: GatewayPluginHttpContext,
): Promise<Response> {
  if (req.method !== 'POST') {
    return Promise.resolve(jsonResponse({ error: 'method not allowed' }, 405))
  }
  return (async () => {
    for (const p of plugins) {
      const handler = p.handleHttp
      if (!handler) continue
      const r = await handler(req, io, httpCtx)
      if (r != null) return r
    }
    return jsonResponse({ error: 'not found' }, 404)
  })()
}

main().catch(err => {
  process.stderr.write(`@omnibot/gateway: ${String(err)}\n`)
  process.exit(1)
})
