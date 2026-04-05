import { resolve } from 'node:path'

import { createOmnimux, type Omnimux, type TerminalSession } from '@omnibot/omnimux'

import { ensureAgentConfigDir } from './agent-config.ts'
import type { AgentsConfig } from './types.ts'

export interface SpawnAgentOptions {
  id?: string
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
}

export class AgentManager {
  private readonly mux: Omnimux
  private readonly agents: AgentsConfig
  private readonly ipcSocketPath: string
  private readonly baseDirAbs: string
  private readonly byId = new Map<
    string,
    {
      info: AgentInfo
      session: TerminalSession
    }
  >()

  constructor(config: AgentsConfig, mux: Omnimux, ipcSocketPath: string) {
    this.agents = config
    this.mux = mux
    this.ipcSocketPath = ipcSocketPath
    this.baseDirAbs = resolve(config.baseDir)
  }

  async spawn(options: SpawnAgentOptions = {}): Promise<AgentInfo> {
    const id = options.id?.trim() || crypto.randomUUID()
    if (this.byId.has(id)) {
      throw new Error(`agent already exists: ${id}`)
    }

    const configDir = ensureAgentConfigDir(
      id,
      this.baseDirAbs,
      this.ipcSocketPath,
      this.agents.templateDir,
    )

    const cmd = options.cmd ?? this.agents.defaultCmd
    const cols = options.cols ?? this.agents.defaultCols
    const rows = options.rows ?? this.agents.defaultRows
    const cwd = options.cwd !== undefined ? options.cwd : configDir

    const env: Record<string, string> = {
      ...options.env,
      CLAUDE_CONFIG_DIR: resolve(configDir, '.claude'),
      HOME: configDir,
      ANTHROPIC_BASE_URL: this.agents.omnirouterUrl,
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
    }

    void session.exited.then(code => {
      const row = this.byId.get(id)
      if (!row) return
      row.info.status = 'exited'
      row.info.exitCode = code
    })

    this.byId.set(id, { info, session })
    return info
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
    this.mux.destroy(id, 'SIGTERM')
    this.byId.delete(id)
  }

  killAll(): void {
    for (const id of [...this.byId.keys()]) {
      this.kill(id)
    }
  }

  sendInput(id: string, data: string): void {
    const s = this.byId.get(id)?.session
    if (!s) throw new Error(`unknown agent: ${id}`)
    s.write(data)
  }

  resize(id: string, cols: number, rows: number): void {
    const s = this.byId.get(id)?.session
    if (!s) throw new Error(`unknown agent: ${id}`)
    s.resize(cols, rows)
  }
}
