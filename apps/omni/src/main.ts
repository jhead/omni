#!/usr/bin/env bun
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

import { AgentBus, OMNI_AGENT_BUS_KEY } from '@omnibot/channel-agent-bus'
import { resolveGatewayIpcSocketPath } from '@omnibot/gateway'
import { createOmnimux } from '@omnibot/omnimux'

import { AgentManager } from './agent-manager.ts'
import { loadOmniAppConfig } from './config.ts'
import { startGatewayHost } from './gateway-host.ts'
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

  const debug = process.env.OMNI_DEBUG === '1' || process.env.OMNI_DEBUG === 'true'
  await startGatewayHost(cfg, { debug })

  const ipcAbs = resolveGatewayIpcSocketPath(cfg)

  const mux = createOmnimux({
    cols: cfg.agents.defaultCols,
    rows: cfg.agents.defaultRows,
  })

  const agentManager = new AgentManager(cfg.agents, mux, ipcAbs)

  const server = startOmniServer({
    hostname: cfg.omniServer.hostname,
    port: cfg.omniServer.port,
    bearerToken: cfg.omniServer.bearerToken,
    agentManager,
  })

  const ctrlUrl = `http://${cfg.omniServer.hostname}:${server.port}`
  const gwUrl = `http://${cfg.gateway.httpHostname ?? '127.0.0.1'}:${cfg.gateway.httpPort}`

  console.error(
    `[omni-app] gateway ${gwUrl} ipc ${ipcAbs}\n` +
      `[omni-app] control plane ${ctrlUrl} (Bearer API + WS /ws/agents/:id)\n`,
  )

  const shutdown = (): void => {
    console.error('[omni-app] shutting down…')
    agentManager.killAll()
    server.stop()
    process.exit(0)
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch(err => {
  console.error('[omni-app]', err)
  process.exit(1)
})
