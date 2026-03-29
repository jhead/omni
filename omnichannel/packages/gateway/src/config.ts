import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { parse as parseYaml } from 'yaml'

import type { CapabilitySet, OmnichannelPluginId } from '@omnichannel/core'

export interface GatewayYaml {
  gateway: {
    httpPort: number
    /** Unix socket path. Relative paths are resolved against `process.cwd()`. */
    ipcSocketPath: string
    dbPath: string
    sharedSecret?: string | null
    /** Ingress queue row TTL in seconds (default 86400). */
    queueTtlSeconds?: number
  }
  channels: Record<
    string,
    {
      plugin: OmnichannelPluginId
    }
  >
}

export interface LoadedConfig extends GatewayYaml {
  configPath: string
}

function capabilityForChannel(
  channelId: string,
  plugin: OmnichannelPluginId,
): CapabilitySet {
  const ingress = true
  const egress = plugin !== 'generic_webhook'
  return {
    channelId,
    plugin,
    ingress,
    egress,
    actions: egress
      ? (['reply', 'react', 'ack', 'resolve', 'noop'] as const)
      : (['noop'] as const),
  }
}

export function getCapabilities(config: LoadedConfig): CapabilitySet[] {
  return Object.entries(config.channels).map(([channelId, ch]) =>
    capabilityForChannel(channelId, ch.plugin),
  )
}

/** Resolve `gateway.ipcSocketPath`: absolute as-is; relative paths use `process.cwd()`. */
export function resolveGatewayIpcSocketPath(config: LoadedConfig): string {
  const raw = config.gateway.ipcSocketPath.trim()
  if (!raw) {
    throw new Error('gateway.ipcSocketPath is empty')
  }
  if (raw.startsWith('/')) return raw
  return resolve(process.cwd(), raw)
}

export function loadConfig(path?: string): LoadedConfig {
  const configPath = resolve(
    path ?? process.env.OMNI_CONFIG ?? 'omni.yaml',
  )
  if (!existsSync(configPath)) {
    throw new Error(
      `omnichannel gateway: config not found: ${configPath}\n` +
        `  Set OMNI_CONFIG or create omni.yaml (see omni.yaml.example).`,
    )
  }
  const raw = readFileSync(configPath, 'utf8')
  const doc = parseYaml(raw) as GatewayYaml
  if (!doc.gateway?.httpPort || !doc.gateway.ipcSocketPath || !doc.gateway.dbPath) {
    throw new Error(
      'omnichannel gateway: omni.yaml must define gateway.httpPort, gateway.ipcSocketPath, gateway.dbPath',
    )
  }
  if (!doc.channels || typeof doc.channels !== 'object') {
    throw new Error('omnichannel gateway: omni.yaml must define channels')
  }
  return { ...doc, configPath }
}
