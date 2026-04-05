import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { parseGatewayDocument, type LoadedGatewayConfig } from '@omnibot/gateway'
import { parse as parseYaml } from 'yaml'

import type { AgentsConfig, OmniConfig, OmniServerConfig } from './types.ts'

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
      raw.omnirouterUrl.trim()
    : 'http://127.0.0.1:3456'
  const templateDir =
    raw.templateDir === null || raw.templateDir === undefined ?
      null
    : typeof raw.templateDir === 'string' ?
      raw.templateDir
    : (() => {
        throw new Error('omni config: agents.templateDir must be a string or null')
      })()
  return {
    baseDir,
    defaultCmd,
    defaultCols,
    defaultRows,
    omnirouterUrl,
    templateDir,
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

  return {
    configPath,
    ...base,
    omniServer,
    agents,
  }
}
