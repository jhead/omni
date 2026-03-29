import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { parse as parseYaml } from 'yaml'

/**
 * Unix socket path for the Gateway IPC.
 * 1) `OMNI_IPC_SOCKET` (trimmed), or
 * 2) `gateway.ipcSocketPath` from `omni.yaml` — relative paths use **`process.cwd()`** (same rule as the Gateway).
 */
export function resolveIpcSocketPath(): string {
  const raw = process.env.OMNI_IPC_SOCKET?.trim()
  if (raw) return raw

  const configPath = resolve(process.cwd(), process.env.OMNI_CONFIG ?? 'omni.yaml')
  if (!existsSync(configPath)) {
    throw new Error(
      `Set OMNI_IPC_SOCKET, or create ${configPath} with gateway.ipcSocketPath (same cwd as the Gateway).`,
    )
  }
  const doc = parseYaml(readFileSync(configPath, 'utf8')) as {
    gateway?: { ipcSocketPath?: string }
  }
  const p = doc.gateway?.ipcSocketPath?.trim()
  if (!p) {
    throw new Error(`${configPath} must define gateway.ipcSocketPath`)
  }
  if (p.startsWith('/')) return p
  return resolve(process.cwd(), p)
}
