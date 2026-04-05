import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import type { LoadedGatewayConfig } from '@omnibot/gateway'

/** Streamable HTTP MCP URL on the gateway (same host/port/path as `createOmniMcpHttpFetchHandler`). */
export function gatewayMcpHttpUrl(cfg: LoadedGatewayConfig): string {
  const host = cfg.gateway.httpHostname?.trim() || '127.0.0.1'
  const port = cfg.gateway.httpPort
  const raw = cfg.gateway.mcpHttpPath
  const path = raw === false || raw === undefined ? '/mcp' : raw
  return new URL(path, `http://${host}:${port}`).href
}

/**
 * Ensure per-agent dir exists with MCP config: gateway Streamable HTTP (`type` + `url`).
 */
export function ensureAgentConfigDir(
  agentId: string,
  baseDir: string,
  gatewayMcpHttpUrl: string,
  templateDir?: string | null,
): string {
  const dir = resolve(baseDir, agentId)
  if (existsSync(dir)) {
    return dir
  }
  mkdirSync(join(dir, '.claude'), { recursive: true })

  const mcpJson = {
    mcpServers: {
      omni: {
        type: 'http',
        url: gatewayMcpHttpUrl,
      },
    },
  }
  writeFileSync(join(dir, '.mcp.json'), JSON.stringify(mcpJson, null, 2) + '\n', 'utf8')

  const settings = {
    enabledMcpjsonServers: ['omni'],
  }
  writeFileSync(
    join(dir, '.claude', 'settings.local.json'),
    JSON.stringify(settings, null, 2) + '\n',
    'utf8',
  )

  if (templateDir && existsSync(templateDir)) {
    cpSync(templateDir, dir, { recursive: true, errorOnExist: false })
  }

  return dir
}
