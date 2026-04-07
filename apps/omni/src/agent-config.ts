import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import type { LoadedGatewayConfig } from '@omnibot/gateway'

import { deepMergeJson } from './json-merge.ts'

/** Streamable HTTP MCP URL on the gateway (same host/port/path as `createOmniMcpHttpFetchHandler`). */
export function gatewayMcpHttpUrl(cfg: LoadedGatewayConfig): string {
  const host = cfg.gateway.httpHostname?.trim() || '127.0.0.1'
  const port = cfg.gateway.httpPort
  const raw = cfg.gateway.mcpHttpPath
  const path = raw === false || raw === undefined ? '/mcp' : raw
  return new URL(path, `http://${host}:${port}`).href
}

export interface MaterializeAgentWorkspaceOptions {
  /** Absolute paths; copied in order (later overlays earlier). */
  templateDirLayers: (string | null | undefined)[]
  /** Written as `CLAUDE.md` when non-empty. */
  claudeMd: string | null | undefined
  /** Deep-merged in order into `.claude/settings.json`. */
  settingsJsonLayers: (Record<string, unknown> | null | undefined)[]
}

/**
 * Create per-agent workspace: copy template layers, merge settings, then apply Omni MCP config last.
 */
export function materializeAgentWorkspace(
  agentId: string,
  baseDir: string,
  gatewayMcpHttpUrl: string,
  options: MaterializeAgentWorkspaceOptions,
): string {
  const dir = resolve(baseDir, agentId)
  if (existsSync(dir)) {
    return dir
  }

  mkdirSync(dir, { recursive: true })
  mkdirSync(join(dir, '.claude'), { recursive: true })

  for (const layer of options.templateDirLayers) {
    const p = layer?.trim()
    if (p && existsSync(p)) {
      cpSync(p, dir, { recursive: true, errorOnExist: false })
    }
  }

  let settingsMerged: Record<string, unknown> = {}
  for (const layer of options.settingsJsonLayers) {
    if (layer !== undefined && layer !== null && typeof layer === 'object' && !Array.isArray(layer)) {
      settingsMerged = deepMergeJson(settingsMerged, layer as Record<string, unknown>)
    }
  }

  const settingsPath = join(dir, '.claude', 'settings.json')
  if (existsSync(settingsPath)) {
    try {
      const raw = readFileSync(settingsPath, 'utf8')
      const parsed = JSON.parse(raw) as unknown
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        settingsMerged = deepMergeJson(parsed as Record<string, unknown>, settingsMerged)
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      throw new Error(`agent ${agentId}: invalid existing .claude/settings.json: ${msg}`)
    }
  }
  writeFileSync(settingsPath, JSON.stringify(settingsMerged, null, 2) + '\n', 'utf8')

  const md = options.claudeMd?.trim()
  if (md) {
    writeFileSync(join(dir, 'CLAUDE.md'), md + '\n', 'utf8')
  }

  const mcpJson = {
    mcpServers: {
      omni: {
        type: 'http',
        url: gatewayMcpHttpUrl,
      },
    },
  }
  writeFileSync(join(dir, '.mcp.json'), JSON.stringify(mcpJson, null, 2) + '\n', 'utf8')

  const settingsLocalPath = join(dir, '.claude', 'settings.local.json')
  let localMerged: Record<string, unknown> = { enabledMcpjsonServers: ['omni'] }
  if (existsSync(settingsLocalPath)) {
    try {
      const raw = readFileSync(settingsLocalPath, 'utf8')
      const parsed = JSON.parse(raw) as unknown
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        localMerged = deepMergeJson(parsed as Record<string, unknown>, localMerged)
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      throw new Error(`agent ${agentId}: invalid existing .claude/settings.local.json: ${msg}`)
    }
  }
  localMerged.enabledMcpjsonServers = ['omni']
  writeFileSync(settingsLocalPath, JSON.stringify(localMerged, null, 2) + '\n', 'utf8')

  return dir
}
