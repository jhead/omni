/**
 * In-process gateway host: same plugin wiring as `omnibot-gateway` CLI, callable from apps/omni.
 */

import {
  createGatewayDebugLogger,
  getCapabilitySetsForChannels,
  getReplyHandleRow,
  jsonResponse,
  startGateway,
  type CreateGatewayPluginHost,
  type GatewayDebugLogger,
  type GatewayIo,
  type GatewayPluginHost,
  type GatewayPluginHostContext,
  type GatewayPluginHttpContext,
  type LoadedGatewayConfig,
} from '@omnibot/gateway'

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
  log: GatewayDebugLogger,
): Promise<Map<string, Record<string, unknown>>> {
  const map = new Map<string, Record<string, unknown>>()
  await Promise.all(
    pluginIds.map(async id => {
      assertValidChannelPluginId(id)
      const specifier = `@omnibot/${id}`
      log.log('plugin', `import ${specifier}`)
      try {
        const mod = (await import(specifier)) as Record<string, unknown>
        map.set(id, mod)
        log.log('plugin', `loaded ${specifier}`, { exports: Object.keys(mod).sort() })
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        throw new Error(`Failed to load channel package ${specifier}: ${msg}`)
      }
    }),
  )
  return map
}

export interface StartGatewayHostOptions {
  extraPlugins?: Array<{ pluginId: string; host: GatewayPluginHost }>
  debug?: boolean
}

export async function startGatewayHost(
  config: LoadedGatewayConfig,
  options?: StartGatewayHostOptions,
): Promise<GatewayIo> {
  const debugLog = createGatewayDebugLogger(Boolean(options?.debug))
  debugLog.log('gateway-host', 'config path', config.configPath)

  const pluginIds = uniqueChannelPluginIds(config.channels)
  debugLog.log('gateway-host', 'channel plugin ids (unique)', pluginIds)

  const channelMods = await importChannelModules(pluginIds, debugLog)

  const ttlSeconds = config.gateway.queueTtlSeconds ?? 86_400
  const ttlMs = ttlSeconds * 1000
  const replyHandleTtlMs = (config.gateway.replyHandleTtlSeconds ?? 604_800) * 1000

  const ctx: GatewayPluginHostContext = {
    channels: config.channels,
    document: config.document,
    replyHandleTtlMs,
    debugLog,
  }

  const plugins: GatewayPluginHost[] = []
  const pluginLabels: string[] = []

  const extras = options?.extraPlugins ?? []
  for (const { pluginId, host } of extras) {
    plugins.push(host)
    pluginLabels.push(pluginId)
  }

  for (const id of [...pluginIds].sort()) {
    const mod = channelMods.get(id)
    if (!mod) continue
    const factory = mod.createGatewayPluginHost as CreateGatewayPluginHost | undefined
    if (typeof factory === 'function') {
      debugLog.log('gateway-host', `createGatewayPluginHost(${id})`)
      plugins.push(factory(mod, ctx))
      pluginLabels.push(id)
    } else {
      debugLog.log('gateway-host', `skip ${id} (no createGatewayPluginHost)`)
    }
  }

  debugLog.log('gateway-host', 'prepare()', { plugins: pluginLabels })
  plugins.forEach(p => p.prepare())

  const httpCtx: GatewayPluginHttpContext = { ttlMs, config }

  return startGateway({
    config,
    debugLog,
    getCapabilities: () => {
      const pluginHosts = plugins.map((host, i) => ({
        pluginId: pluginLabels[i] ?? '',
        host,
      }))
      const caps = getCapabilitySetsForChannels(config.channels, pluginHosts)
      debugLog.log('gateway-host', 'getCapabilities()', caps)
      return caps
    },
    onInvoke: async (d, { db }) => {
      debugLog.log('invoke', 'inbound', d)

      let channelId = d.channelId
      let route: Record<string, unknown> | undefined

      if (d.replyHandle) {
        const row = getReplyHandleRow(db, d.replyHandle)
        if (!row) {
          debugLog.log('invoke', 'unknown replyHandle', { replyHandle: d.replyHandle })
          return { ok: false, error: 'unknown or expired reply handle' }
        }
        channelId = row.omni_channel_id
        try {
          route = JSON.parse(row.route_json) as Record<string, unknown>
        } catch {
          debugLog.log('invoke', 'invalid route_json', { raw: row.route_json })
          return { ok: false, error: 'invalid route data' }
        }
        debugLog.log('invoke', 'resolved replyHandle', { channelId, route })
      }

      for (let i = 0; i < plugins.length; i++) {
        const p = plugins[i]
        if (!p) break
        const label = pluginLabels[i] ?? `plugin[${i}]`
        debugLog.log('invoke', `invoke(${label})`)
        const r = await p.invoke({ channelId, capability: d.capability, args: d.args, route })
        debugLog.log('invoke', `invoke(${label}) result`, r ?? null)
        if (r != null) return r
      }

      debugLog.log('invoke', 'no plugin handled invoke')
      return { ok: false, error: 'no handler for this channel/capability' }
    },
    fetch: (req, io) =>
      dispatchPluginHttp(req, io, plugins, pluginLabels, httpCtx, debugLog),
    afterHubReady: async io => {
      for (let i = 0; i < plugins.length; i++) {
        const p = plugins[i]
        if (!p) break
        const label = pluginLabels[i] ?? `plugin[${i}]`
        debugLog.log('gateway-host', `afterHubReady(${label})`)
        await p.afterHubReady(io)
      }
    },
  })
}

function dispatchPluginHttp(
  req: Request,
  io: GatewayIo,
  plugins: GatewayPluginHost[],
  pluginLabels: string[],
  httpCtx: GatewayPluginHttpContext,
  debugLog: GatewayDebugLogger,
): Promise<Response> {
  if (req.method !== 'POST') {
    debugLog.log('http', 'reject non-POST', { method: req.method, url: req.url })
    return Promise.resolve(jsonResponse({ error: 'method not allowed' }, 405))
  }
  return (async () => {
    for (let i = 0; i < plugins.length; i++) {
      const plugin = plugins[i]
      if (!plugin) break
      const handler = plugin.handleHttp
      const label = pluginLabels[i] ?? `plugin[${i}]`
      if (!handler) {
        debugLog.log('http', `skip handleHttp(${label}) (none)`)
        continue
      }
      debugLog.log('http', `handleHttp(${label})`)
      const r = await handler(req, io, httpCtx)
      debugLog.log('http', `handleHttp(${label}) result`, { handled: r != null, status: r?.status })
      if (r != null) return r
    }
    debugLog.log('http', 'no plugin handled request', { url: req.url })
    return jsonResponse({ error: 'not found' }, 404)
  })()
}
