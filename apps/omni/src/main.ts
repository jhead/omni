#!/usr/bin/env bun
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

import { AgentBus, OMNI_AGENT_BUS_KEY } from '@omnibot/channel-agent-bus'
import { resolveGatewayIpcSocketPath } from '@omnibot/gateway'
import { createOmnimux } from '@omnibot/omnimux'
import { createOmnirouter } from '@omnibot/omnirouter'

import { gatewayMcpHttpUrl } from './agent-config.ts'
import { AgentManager } from './agent-manager.ts'
import { AgentPersistence } from './agent-persistence.ts'
import { loadOmniAppConfig } from './config.ts'
import { startGatewayHost } from './gateway-host.ts'
import { resolveMcpAutoSubscribe } from './mcp-auto-subscribe.ts'
import { buildOmnirouterProxyConfig, resolveAnthropicProxyBaseUrl } from './omnirouter-config.ts'
import { startOmniServer } from './omni-server.ts'

function ensureParentDir(filePath: string): void {
  const dir = dirname(filePath)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

async function main(): Promise<void> {
  const cfg = loadOmniAppConfig()

  const needsBus = Object.values(cfg.channels).some(c => c.plugin === 'channel-agent-bus')
  if (needsBus) {
    cfg.document[OMNI_AGENT_BUS_KEY] = new AgentBus()
  }

  ensureParentDir(resolve(cfg.configPath, '..', cfg.gateway.dbPath))

  const omnirouterHandle = cfg.omnirouter.enabled ?
    createOmnirouter({ config: buildOmnirouterProxyConfig(cfg.omnirouter) })
  : null

  const anthropicProxyUrl = resolveAnthropicProxyBaseUrl(cfg)

  const debug = process.env.OMNI_DEBUG === '1' || process.env.OMNI_DEBUG === 'true'
  await startGatewayHost(cfg, { debug, mcpAutoSubscribe: resolveMcpAutoSubscribe(cfg) })

  const ipcAbs = resolveGatewayIpcSocketPath(cfg)

  const mux = createOmnimux({
    cols: 120,
    rows: 40,
  })

  const agentsDbAbs = resolve(dirname(cfg.configPath), cfg.agents.persistenceDbPath)
  ensureParentDir(agentsDbAbs)

  const persistence = new AgentPersistence(agentsDbAbs)
  persistence.ensureDefaultTemplateSeed({
    deprecatedYaml: cfg.deprecatedAgentsTemplateSeed,
    fallbackTemplateDirRel: '../../reference/template',
    fallbackDefaultCmd: [
      'claude',
      '--dangerously-skip-permissions',
      '--dangerously-load-development-channels',
      'server:omni',
    ],
    fallbackCols: 120,
    fallbackRows: 40,
  })

  const agentManager = new AgentManager(
    cfg.agents,
    mux,
    gatewayMcpHttpUrl(cfg),
    anthropicProxyUrl,
    persistence,
    cfg.configPath,
  )

  const server = startOmniServer({
    hostname: cfg.omniServer.hostname,
    port: cfg.omniServer.port,
    bearerToken: cfg.omniServer.bearerToken,
    agentManager,
  })

  const ctrlUrl = `http://${cfg.omniServer.hostname}:${server.port}`
  const gwUrl = `http://${cfg.gateway.httpHostname ?? '127.0.0.1'}:${cfg.gateway.httpPort}`
  const mcpHttp =
    cfg.gateway.mcpHttpPath === false ? '' : ` MCP http ${gwUrl}${cfg.gateway.mcpHttpPath}`

  const routerLine =
    omnirouterHandle ?
      `[omni-app] omnirouter ${anthropicProxyUrl} → ${cfg.omnirouter.upstreamBaseUrl} (passthrough=${cfg.omnirouter.passthrough !== false})\n`
    : `[omni-app] omnirouter external ${anthropicProxyUrl}\n`

  console.error(
    `${routerLine}` +
      `[omni-app] gateway ${gwUrl} ipc ${ipcAbs}${mcpHttp}\n` +
      `[omni-app] control plane ${ctrlUrl} (Bearer API + WS /ws/agents/:id)\n`,
  )

  const shutdown = (): void => {
    console.error('[omni-app] shutting down…')
    agentManager.shutdownPersistAndClear()
    server.stop()
    omnirouterHandle?.stop()
    process.exit(0)
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch(err => {
  console.error('[omni-app]', err)
  process.exit(1)
})
