import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

import type { Omnimux, TerminalSession } from '@omnibot/omnimux'

import { materializeAgentWorkspace } from './agent-config.ts'
import { AgentPersistence, DEFAULT_AGENT_TEMPLATE_ID } from './agent-persistence.ts'
import type { AgentTemplateRow, AgentsConfig } from './types.ts'

export interface SpawnAgentOptions {
  id?: string
  /** Named template layered on top of `default`. Omit or `default` for base only. */
  templateId?: string
  cmd?: [string, ...string[]]
  cwd?: string
  env?: Record<string, string>
  cols?: number
  rows?: number
}

export type AgentStatus = 'running' | 'exited'

export interface AgentInfo {
  id: string
  status: AgentStatus
  exitCode: number | null
  cmd: string[]
  cwd?: string
  configDir: string
  cols: number
  rows: number
  /** User-supplied env overrides only (mirrors spawn options). */
  env?: Record<string, string>
}

type AgentRow = {
  info: AgentInfo
  session?: TerminalSession
}

const FALLBACK_SPAWN_CMD: [string, ...string[]] = ['claude']
const FALLBACK_COLS = 120
const FALLBACK_ROWS = 40

function resolveTemplateDirOnDisk(
  templateDir: string | null | undefined,
  configPath: string,
): string | null {
  if (templateDir === undefined || templateDir === null || templateDir.trim() === '') {
    return null
  }
  const t = templateDir.trim()
  if (t.startsWith('/')) return t
  return resolve(dirname(configPath), t)
}

function mergeClaudeMd(defaultT: AgentTemplateRow, namedT: AgentTemplateRow | undefined): string | null {
  const a = defaultT.claudeMd?.trim() ?? ''
  const b = namedT?.claudeMd?.trim() ?? ''
  if (a && b) return `${a}\n\n---\n\n${b}`
  if (a) return a
  if (b) return b
  return null
}

export class AgentManager {
  private readonly mux: Omnimux
  private readonly agents: AgentsConfig
  private readonly gatewayMcpHttpUrl: string
  /** Resolved `ANTHROPIC_BASE_URL` for agent PTYs (in-process or external omnirouter). */
  private readonly anthropicProxyBaseUrl: string
  private readonly baseDirAbs: string
  private readonly configPath: string
  private readonly persistence: AgentPersistence
  private readonly byId = new Map<string, AgentRow>()

  constructor(
    config: AgentsConfig,
    mux: Omnimux,
    gatewayMcpHttpUrl: string,
    anthropicProxyBaseUrl: string,
    persistence: AgentPersistence,
    configPath: string,
  ) {
    this.agents = config
    this.mux = mux
    this.gatewayMcpHttpUrl = gatewayMcpHttpUrl
    this.anthropicProxyBaseUrl = anthropicProxyBaseUrl.replace(/\/$/, '')
    this.baseDirAbs = resolve(config.baseDir)
    this.persistence = persistence
    this.configPath = configPath
    this.hydrateFromPersistence()
  }

  /** Exposed for control-plane template CRUD. */
  getPersistence(): AgentPersistence {
    return this.persistence
  }

  private hydrateFromPersistence(): void {
    this.persistence.reconcileOrphanedRunning()
    const rows = this.persistence.loadAllExited()
    for (const r of rows) {
      if (!existsSync(r.configDir)) {
        console.error(
          `[omni-app] persisted agent ${r.id}: config dir missing (${r.configDir}); dropping registry row`,
        )
        this.persistence.delete(r.id)
        continue
      }
      this.byId.set(r.id, {
        info: {
          id: r.id,
          status: 'exited',
          exitCode: r.exitCode,
          cmd: r.cmd,
          cwd: r.cwd,
          configDir: r.configDir,
          cols: r.cols,
          rows: r.rows,
          env: r.envExtra ?? undefined,
        },
      })
    }
  }

  private resolveSpawnTemplates(options: SpawnAgentOptions): {
    defaultT: AgentTemplateRow
    namedT: AgentTemplateRow | undefined
  } {
    const defaultT = this.persistence.getTemplate(DEFAULT_AGENT_TEMPLATE_ID)
    if (!defaultT) {
      throw new Error('missing default agent template; database bootstrap failed')
    }
    const tid = options.templateId?.trim() || DEFAULT_AGENT_TEMPLATE_ID
    if (tid === DEFAULT_AGENT_TEMPLATE_ID) {
      return { defaultT, namedT: undefined }
    }
    const namedT = this.persistence.getTemplate(tid)
    if (!namedT) {
      throw new Error(`unknown template: ${tid}`)
    }
    return { defaultT, namedT }
  }

  async spawn(options: SpawnAgentOptions = {}): Promise<AgentInfo> {
    const id = options.id?.trim() || crypto.randomUUID()
    if (this.byId.has(id)) {
      throw new Error(`agent already exists: ${id}`)
    }

    const { defaultT, namedT } = this.resolveSpawnTemplates(options)

    const templateDirLayers = [
      resolveTemplateDirOnDisk(defaultT.templateDir, this.configPath),
      resolveTemplateDirOnDisk(namedT?.templateDir, this.configPath),
    ]

    const claudeMd = mergeClaudeMd(defaultT, namedT)
    const settingsJsonLayers = [defaultT.settingsJson, namedT?.settingsJson]

    const configDir = materializeAgentWorkspace(id, this.baseDirAbs, this.gatewayMcpHttpUrl, {
      templateDirLayers,
      claudeMd,
      settingsJsonLayers,
    })

    const cmdFromTemplates =
      namedT?.defaultCmd !== undefined && namedT.defaultCmd !== null ?
        namedT.defaultCmd
      : defaultT.defaultCmd !== undefined && defaultT.defaultCmd !== null ? defaultT.defaultCmd
      : FALLBACK_SPAWN_CMD

    const colsFromTemplates =
      namedT?.defaultCols ?? defaultT.defaultCols ?? FALLBACK_COLS
    const rowsFromTemplates =
      namedT?.defaultRows ?? defaultT.defaultRows ?? FALLBACK_ROWS

    const cmd = options.cmd ?? cmdFromTemplates
    const cols = options.cols ?? colsFromTemplates
    const rows = options.rows ?? rowsFromTemplates
    const cwd = options.cwd !== undefined ? options.cwd : configDir

    const env: Record<string, string> = {
      ...options.env,
      CLAUDE_CONFIG_DIR: resolve(configDir, '.claude'),
      HOME: configDir,
      ANTHROPIC_BASE_URL: this.anthropicProxyBaseUrl,
    }

    const session = this.mux.createSession({
      id,
      cmd,
      cwd,
      env,
      cols,
      rows,
    })

    const info: AgentInfo = {
      id,
      status: 'running',
      exitCode: null,
      cmd: [...cmd],
      cwd,
      configDir,
      cols,
      rows,
      env: options.env && Object.keys(options.env).length > 0 ? { ...options.env } : undefined,
    }

    try {
      this.persistence.upsertRunning({
        id,
        cmd: [...cmd],
        cwd,
        configDir,
        cols,
        rows,
        envExtra: options.env,
      })
    } catch (e) {
      this.mux.destroy(id, 'SIGTERM')
      throw e
    }

    void session.exited.then(code => {
      const row = this.byId.get(id)
      if (!row) return
      row.info.status = 'exited'
      row.info.exitCode = code
      this.persistence.updateExited(id, code)
    })

    this.byId.set(id, { info, session })
    return info
  }

  /**
   * Spawn a new PTY for an existing agent id after the previous session exited.
   * Reuses the same config directory; does not re-apply template (dir already exists).
   */
  async restart(id: string): Promise<AgentInfo> {
    const trimmed = id.trim()
    const row = this.byId.get(trimmed)
    if (!row) {
      throw new Error(`unknown agent: ${id}`)
    }
    if (row.info.status !== 'exited') {
      throw new Error(
        `agent ${trimmed} is not exited (status=${row.info.status}); use spawn for new ids or kill first`,
      )
    }
    const { cmd, cwd, cols, rows, env } = row.info
    this.byId.delete(trimmed)
    const fallbackCmd = this.resolveRestartCmd(cmd)
    return this.spawn({
      id: trimmed,
      cmd: cmd.length > 0 ? (cmd as [string, ...string[]]) : fallbackCmd,
      cwd,
      cols,
      rows,
      env,
    })
  }

  private resolveRestartCmd(persistedCmd: string[]): [string, ...string[]] {
    if (persistedCmd.length > 0) {
      return persistedCmd as [string, ...string[]]
    }
    const d = this.persistence.getTemplate(DEFAULT_AGENT_TEMPLATE_ID)
    if (d?.defaultCmd && d.defaultCmd.length > 0) {
      return d.defaultCmd
    }
    return FALLBACK_SPAWN_CMD
  }

  list(): AgentInfo[] {
    return [...this.byId.values()].map(r => ({ ...r.info }))
  }

  get(id: string): AgentInfo | undefined {
    const r = this.byId.get(id)
    return r ? { ...r.info } : undefined
  }

  getSession(id: string): TerminalSession | undefined {
    return this.byId.get(id)?.session
  }

  kill(id: string): void {
    const row = this.byId.get(id)
    if (!row) return
    this.persistence.delete(id)
    if (row.session) {
      this.mux.destroy(id, 'SIGTERM')
    }
    this.byId.delete(id)
  }

  /**
   * Graceful shutdown: persist agents as exited, tear down PTYs, clear in-memory map.
   * Rows remain in SQLite so the next process can hydrate and offer Restart.
   */
  shutdownPersistAndClear(): void {
    this.persistence.markAllRunningAsExited()
    for (const id of [...this.byId.keys()]) {
      const row = this.byId.get(id)
      if (row?.session) {
        this.mux.destroy(id, 'SIGTERM')
      }
    }
    this.byId.clear()
  }

  sendInput(id: string, data: string): void {
    const s = this.byId.get(id)?.session
    if (!s) throw new Error(`agent ${id} has no active PTY session`)
    s.write(data)
  }

  resize(id: string, cols: number, rows: number): void {
    const s = this.byId.get(id)?.session
    if (!s) throw new Error(`agent ${id} has no active PTY session`)
    s.resize(cols, rows)
  }
}
