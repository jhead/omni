import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { parseGatewayDocument, type LoadedGatewayConfig } from '@omnibot/gateway'
import { parse as parseYaml } from 'yaml'

import type { AgentsConfig, OmniConfig, OmniServerConfig, OmnirouterAppConfig } from './types.ts'

function isRecord(x: unknown): x is Record<string, unknown> {
  return x !== null && typeof x === 'object' && !Array.isArray(x)
}

function parseOmniServer(raw: unknown): OmniServerConfig {
  if (!isRecord(raw)) {
    throw new Error('omni config: omniServer must be an object')
  }
  const hostname =
    typeof raw.hostname === 'string' && raw.hostname.trim() ? raw.hostname.trim() : '127.0.0.1'
  const port = raw.port
  if (typeof port !== 'number' || !Number.isFinite(port)) {
    throw new Error('omni config: omniServer.port must be a number')
  }
  const bearerToken =
    typeof raw.bearerToken === 'string' && raw.bearerToken.length > 0 ?
      raw.bearerToken
    : 'change-me'
  return { hostname, port, bearerToken }
}

function parseAgents(raw: unknown): AgentsConfig {
  if (!isRecord(raw)) {
    throw new Error('omni config: agents must be an object')
  }
  const baseDir =
    typeof raw.baseDir === 'string' && raw.baseDir.trim() ? raw.baseDir.trim() : './data/agents'
  const dc = raw.defaultCmd
  let defaultCmd: [string, ...string[]]
  if (Array.isArray(dc) && dc.length > 0 && dc.every((x): x is string => typeof x === 'string')) {
    defaultCmd = [dc[0]!, ...dc.slice(1)]
  } else {
    defaultCmd = ['claude']
  }
  const defaultCols =
    typeof raw.defaultCols === 'number' && Number.isFinite(raw.defaultCols) ? raw.defaultCols : 120
  const defaultRows =
    typeof raw.defaultRows === 'number' && Number.isFinite(raw.defaultRows) ? raw.defaultRows : 40
  const omnirouterUrl =
    typeof raw.omnirouterUrl === 'string' && raw.omnirouterUrl.trim() ?
      raw.omnirouterUrl.trim().replace(/\/$/, '')
    : null
  const templateDir =
    raw.templateDir === null || raw.templateDir === undefined ?
      null
    : typeof raw.templateDir === 'string' ?
      raw.templateDir
    : (() => {
        throw new Error('omni config: agents.templateDir must be a string or null')
      })()
  const persistenceDbPath =
    typeof raw.persistenceDbPath === 'string' && raw.persistenceDbPath.trim() ?
      raw.persistenceDbPath.trim()
    : './data/omni-agents.sqlite'
  return {
    baseDir,
    defaultCmd,
    defaultCols,
    defaultRows,
    persistenceDbPath,
    omnirouterUrl,
    templateDir,
  }
}

function defaultUpstreamBaseUrl(): string {
  const fromEnv = process.env.OMNI_UPSTREAM_BASE_URL?.trim()
  if (fromEnv) {
    return fromEnv.replace(/\/$/, '')
  }
  return 'https://api.anthropic.com'
}

function parseOmnirouter(raw: unknown): OmnirouterAppConfig {
  const upstreamDefault = defaultUpstreamBaseUrl()
  if (raw === undefined || raw === null) {
    return {
      enabled: true,
      listen: { hostname: '127.0.0.1', port: 3456 },
      upstreamBaseUrl: upstreamDefault,
      passthrough: true,
    }
  }
  if (!isRecord(raw)) {
    throw new Error('omni config: omnirouter must be an object')
  }

  const enabled = raw.enabled === false ? false : true

  let listen: OmnirouterAppConfig['listen'] = { hostname: '127.0.0.1', port: 3456 }
  if (raw.listen !== undefined) {
    if (!isRecord(raw.listen)) {
      throw new Error('omni config: omnirouter.listen must be an object')
    }
    const h =
      typeof raw.listen.hostname === 'string' && raw.listen.hostname.trim() ?
        raw.listen.hostname.trim()
      : '127.0.0.1'
    const p = raw.listen.port
    if (typeof p !== 'number' || !Number.isFinite(p)) {
      throw new Error('omni config: omnirouter.listen.port must be a number')
    }
    listen = { hostname: h, port: p }
  }

  const upstreamBaseUrl =
    typeof raw.upstreamBaseUrl === 'string' && raw.upstreamBaseUrl.trim() ?
      raw.upstreamBaseUrl.trim().replace(/\/$/, '')
    : upstreamDefault

  const passthrough = raw.passthrough === false ? false : true

  let model: string | undefined
  let toolAllowlist: string[] | undefined

  if (!passthrough) {
    if (typeof raw.model !== 'string' || !raw.model.trim()) {
      throw new Error(
        'omni config: omnirouter.model is required when omnirouter.passthrough is false',
      )
    }
    model = raw.model.trim()
    const tl = raw.toolAllowlist
    if (
      !Array.isArray(tl) ||
      tl.length === 0 ||
      !tl.every((x): x is string => typeof x === 'string' && x.trim() !== '')
    ) {
      throw new Error(
        'omni config: omnirouter.toolAllowlist must be a non-empty array of strings when passthrough is false',
      )
    }
    toolAllowlist = tl.map(s => s.trim())
  } else {
    if (typeof raw.model === 'string' && raw.model.trim()) {
      model = raw.model.trim()
    }
    if (Array.isArray(raw.toolAllowlist)) {
      const tl = raw.toolAllowlist.filter(
        (x): x is string => typeof x === 'string' && x.trim() !== '',
      )
      if (tl.length > 0) {
        toolAllowlist = tl.map(s => s.trim())
      }
    }
  }

  let stripAdaptiveThinkingForModels: string[] | undefined
  if (raw.stripAdaptiveThinkingForModels !== undefined) {
    const a = raw.stripAdaptiveThinkingForModels
    if (!Array.isArray(a) || !a.every((x): x is string => typeof x === 'string' && x.trim() !== '')) {
      throw new Error(
        'omni config: omnirouter.stripAdaptiveThinkingForModels must be an array of non-empty strings',
      )
    }
    stripAdaptiveThinkingForModels = a.map(s => s.trim())
  }

  return {
    enabled,
    listen,
    upstreamBaseUrl,
    passthrough,
    model,
    toolAllowlist,
    stripAdaptiveThinkingForModels,
  }
}

/**
 * Load `omni.config.yaml` (or `OMNI_APP_CONFIG`) and validate gateway + omniServer + agents.
 */
export function loadOmniAppConfig(path?: string): OmniConfig {
  const configPath = resolve(path ?? process.env.OMNI_APP_CONFIG ?? 'omni.config.yaml')
  if (!existsSync(configPath)) {
    throw new Error(
      `omni app config: file not found: ${configPath}\n` +
        `  Set OMNI_APP_CONFIG or create omni.config.yaml next to cwd.`,
    )
  }
  const raw = readFileSync(configPath, 'utf8')
  const doc = parseYaml(raw) as unknown
  if (!isRecord(doc)) {
    throw new Error('omni app config: root must be a mapping')
  }

  const base = parseGatewayDocument(doc) as Omit<LoadedGatewayConfig, 'configPath'>
  const omniServer = parseOmniServer(doc.omniServer)
  const agents = parseAgents(doc.agents)
  const omnirouter = parseOmnirouter(doc.omnirouter)

  if (!omnirouter.enabled && !agents.omnirouterUrl?.trim()) {
    throw new Error(
      'omni config: set omnirouter.enabled: true or provide agents.omnirouterUrl for an external router',
    )
  }

  return {
    configPath,
    ...base,
    omniServer,
    agents,
    omnirouter,
  }
}
