import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { parse as parseYaml } from 'yaml'

/**
 * Process / transport / storage only. No channel plugins, no Discord/webhook semantics.
 */

export interface GatewaySection {
  httpHostname?: string
  httpPort: number
  ipcSocketPath: string
  dbPath: string
  sharedSecret?: string | null
  queueTtlSeconds?: number
  replyHandleTtlSeconds?: number
}

/** Each channel row must include `plugin`; other keys are opaque to the gateway. */
export type ChannelRow = { plugin: string } & Record<string, unknown>

export interface LoadedGatewayConfig {
  configPath: string
  gateway: GatewaySection
  channels: Record<string, ChannelRow>
  /** Full parsed `omni.yaml` root — consumers (host process) read plugin-specific keys. */
  document: Record<string, unknown>
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return x !== null && typeof x === 'object' && !Array.isArray(x)
}

export function parseGatewayDocument(root: unknown): Omit<
  LoadedGatewayConfig,
  'configPath'
> {
  if (!isRecord(root)) {
    throw new Error('omni config: root must be a mapping')
  }
  const gw = root.gateway
  if (!isRecord(gw)) {
    throw new Error('omni config: missing gateway section')
  }
  const httpPort = gw.httpPort
  const ipcSocketPath = gw.ipcSocketPath
  const dbPath = gw.dbPath
  if (typeof httpPort !== 'number' || typeof ipcSocketPath !== 'string') {
    throw new Error(
      'omni config: gateway must set httpPort (number) and ipcSocketPath (string)',
    )
  }
  if (typeof dbPath !== 'string') {
    throw new Error('omni config: gateway.dbPath must be a string')
  }

  const gateway: GatewaySection = {
    httpHostname:
      typeof gw.httpHostname === 'string' ? gw.httpHostname : undefined,
    httpPort,
    ipcSocketPath,
    dbPath,
    sharedSecret:
      gw.sharedSecret === undefined
        ? undefined
        : gw.sharedSecret === null
          ? null
          : typeof gw.sharedSecret === 'string'
            ? gw.sharedSecret
            : String(gw.sharedSecret),
    queueTtlSeconds:
      typeof gw.queueTtlSeconds === 'number' ? gw.queueTtlSeconds : undefined,
    replyHandleTtlSeconds:
      typeof gw.replyHandleTtlSeconds === 'number'
        ? gw.replyHandleTtlSeconds
        : undefined,
  }

  const ch = root.channels
  if (!isRecord(ch)) {
    throw new Error('omni config: channels must be a mapping')
  }

  const channels: Record<string, ChannelRow> = {}
  for (const [id, row] of Object.entries(ch)) {
    if (!isRecord(row) || typeof row.plugin !== 'string') {
      throw new Error(
        `omni config: channels.${id} must be an object with a string plugin field`,
      )
    }
    channels[id] = row as ChannelRow
  }

  return { gateway, channels, document: root }
}

export function loadGatewayConfig(path?: string): LoadedGatewayConfig {
  const configPath = resolve(
    path ?? process.env.OMNI_CONFIG ?? 'omni.yaml',
  )
  if (!existsSync(configPath)) {
    throw new Error(
      `omni config: file not found: ${configPath}\n` +
        `  Set OMNI_CONFIG or create omni.yaml (see omni.yaml.example).`,
    )
  }
  const raw = readFileSync(configPath, 'utf8')
  const doc = parseYaml(raw) as unknown
  const parsed = parseGatewayDocument(doc)
  return { configPath, ...parsed }
}

export function resolveGatewayIpcSocketPath(config: LoadedGatewayConfig): string {
  const raw = config.gateway.ipcSocketPath.trim()
  if (!raw) {
    throw new Error('gateway.ipcSocketPath is empty')
  }
  if (raw.startsWith('/')) return raw
  return resolve(process.cwd(), raw)
}
