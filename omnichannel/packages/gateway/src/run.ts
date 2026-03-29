import type { Database } from 'bun:sqlite'
import { resolve } from 'node:path'

import type { CapabilitySet } from '@omnibot/core'

import {
  resolveGatewayIpcSocketPath,
  type LoadedGatewayConfig,
} from './config.ts'
import {
  deleteQueuedEvent as dbDeleteQueuedEvent,
  gcExpired,
  gcExpiredReplyHandles,
  listPendingEvents,
  openDatabase,
} from './db.ts'
import { serveGatewayHttp } from './http-listener.ts'
import {
  createIpcHub,
  type DispatchResult,
  type IpcDispatchInbound,
  type IpcHub,
} from './ipc.ts'

export interface GatewayIo {
  db: Database
  hub: IpcHub
}

export interface StartGatewayOptions {
  config: LoadedGatewayConfig
  getCapabilities: () => CapabilitySet[]
  onDispatch: (input: IpcDispatchInbound, io: GatewayIo) => Promise<DispatchResult>
  fetch: (req: Request, io: GatewayIo) => Response | Promise<Response>
  /** Runs after IPC hub is listening, before HTTP bind. */
  afterHubReady?: (io: GatewayIo) => Promise<void>
}

/**
 * IPC hub, SQLite ingress queue, periodic GC, HTTP listener.
 * Callers supply capabilities, HTTP `fetch`, and dispatch handling.
 */
export async function startGateway(options: StartGatewayOptions): Promise<GatewayIo> {
  const { config } = options
  const dbPath = resolve(config.configPath, '..', config.gateway.dbPath)
  const db = openDatabase(dbPath)
  const ipcPath = resolveGatewayIpcSocketPath(config)

  let hub: IpcHub
  const flushQueue = (): void => {
    const now = Date.now()
    for (const event of listPendingEvents(db, now)) {
      hub.broadcast({ type: 'event', event })
      dbDeleteQueuedEvent(db, event.id)
    }
  }

  hub = createIpcHub({
    socketPath: ipcPath,
    sharedSecret: config.gateway.sharedSecret,
    getCapabilities: options.getCapabilities,
    onClientReady: flushQueue,
    onDispatch: d => options.onDispatch(d, { db, hub }),
  })

  await hub.start()

  const io: GatewayIo = { db, hub }
  await options.afterHubReady?.(io)

  const gc = (): void => {
    const now = Date.now()
    const nq = gcExpired(db, now)
    const nr = gcExpiredReplyHandles(db, now)
    if (nq > 0 || nr > 0) {
      process.stderr.write(
        `omnichannel gateway: gc ingress=${nq} reply_handles=${nr}\n`,
      )
    }
  }
  setInterval(gc, 5 * 60 * 1000)

  const httpHostname = config.gateway.httpHostname?.trim() || '127.0.0.1'

  const server = serveGatewayHttp({
    hostname: httpHostname,
    port: config.gateway.httpPort,
    fetch: req => options.fetch(req, io),
  })

  process.stderr.write(
    `omnichannel gateway: listening http://${httpHostname}:${server.port} ` +
      `ipc ${ipcPath} db=${dbPath}\n`,
  )

  void server

  return io
}
