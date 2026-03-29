#!/usr/bin/env bun
/**
 * Omnichannel Gateway — composition root: wiring only.
 */

import { resolve } from 'node:path'

import {
  getCapabilities,
  loadConfig,
  resolveGatewayIpcSocketPath,
} from './config.ts'
import {
  deleteQueuedEvent,
  gcExpired,
  listPendingEvents,
  openDatabase,
} from './db.ts'
import { jsonResponse } from './http-util.ts'
import { createIpcHub, type IpcHub } from './ipc.ts'
import type { WebhookIngressContext } from './webhooks.ts'
import { handleWebhookPost } from './webhooks.ts'

async function main(): Promise<void> {
  const config = loadConfig(process.argv[2])
  const dbPath = resolve(config.configPath, '..', config.gateway.dbPath)
  const db = openDatabase(dbPath)
  const ipcPath = resolveGatewayIpcSocketPath(config)

  const ttlSeconds = config.gateway.queueTtlSeconds ?? 86_400
  const ttlMs = ttlSeconds * 1000

  const getCaps = () => getCapabilities(config)

  let hub: IpcHub
  const flushQueue = (): void => {
    const now = Date.now()
    for (const event of listPendingEvents(db, now)) {
      hub.broadcast({ type: 'event', event })
      deleteQueuedEvent(db, event.id)
    }
  }

  hub = createIpcHub(config, ipcPath, getCaps, flushQueue)

  await hub.start()

  const gc = (): void => {
    const n = gcExpired(db, Date.now())
    if (n > 0) {
      process.stderr.write(`omnichannel gateway: gc removed ${n} expired queue row(s)\n`)
    }
  }
  setInterval(gc, 5 * 60 * 1000)

  const ingressCtx: WebhookIngressContext = {
    config,
    db,
    hub,
    ttlMs,
  }

  const server = Bun.serve({
    port: config.gateway.httpPort,
    fetch(req): Promise<Response> {
      if (req.method !== 'POST') {
        return Promise.resolve(jsonResponse({ error: 'method not allowed' }, 405))
      }
      return handleWebhookPost(req, ingressCtx)
    },
  })

  process.stderr.write(
    `omnichannel gateway: listening http://127.0.0.1:${server.port} ` +
      `ipc ${ipcPath} db=${dbPath}\n`,
  )
}

main().catch(err => {
  process.stderr.write(`omnichannel gateway: ${String(err)}\n`)
  process.exit(1)
})
