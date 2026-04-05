import { Database } from 'bun:sqlite'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

export interface PersistedAgentRow {
  id: string
  cmd: string[]
  cwd: string
  configDir: string
  cols: number
  rows: number
  /** User-provided env overrides only (merged with CLAUDE_CONFIG_DIR etc. on spawn). */
  envExtra: Record<string, string> | null
  status: 'running' | 'exited'
  exitCode: number | null
}

export class AgentPersistence {
  private readonly db: Database
  private readonly upsertStmt: ReturnType<Database['prepare']>
  private readonly updateExitedStmt: ReturnType<Database['prepare']>
  private readonly deleteStmt: ReturnType<Database['prepare']>
  private readonly selectAllStmt: ReturnType<Database['prepare']>

  constructor(dbPathAbs: string) {
    const dir = dirname(dbPathAbs)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    this.db = new Database(dbPathAbs)
    this.db.run(`
      CREATE TABLE IF NOT EXISTS omni_agents (
        id TEXT PRIMARY KEY NOT NULL,
        cmd_json TEXT NOT NULL,
        cwd TEXT NOT NULL,
        config_dir TEXT NOT NULL,
        cols INTEGER NOT NULL,
        rows INTEGER NOT NULL,
        env_json TEXT,
        status TEXT NOT NULL CHECK (status IN ('running', 'exited')),
        exit_code INTEGER
      );
    `)

    this.upsertStmt = this.db.prepare(`
      INSERT INTO omni_agents (id, cmd_json, cwd, config_dir, cols, rows, env_json, status, exit_code)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'running', NULL)
      ON CONFLICT(id) DO UPDATE SET
        cmd_json = excluded.cmd_json,
        cwd = excluded.cwd,
        config_dir = excluded.config_dir,
        cols = excluded.cols,
        rows = excluded.rows,
        env_json = excluded.env_json,
        status = 'running',
        exit_code = NULL
    `)

    this.updateExitedStmt = this.db.prepare(
      `UPDATE omni_agents SET status = 'exited', exit_code = ?2 WHERE id = ?1`,
    )

    this.deleteStmt = this.db.prepare(`DELETE FROM omni_agents WHERE id = ?`)

    this.selectAllStmt = this.db.prepare(
      `SELECT id, cmd_json, cwd, config_dir, cols, rows, env_json, status, exit_code FROM omni_agents WHERE status = 'exited' ORDER BY id`,
    )
  }

  /** After a crash, processes that were "running" are marked exited with unknown exit code. */
  reconcileOrphanedRunning(): void {
    this.db.run(
      `UPDATE omni_agents SET status = 'exited', exit_code = NULL WHERE status = 'running'`,
    )
  }

  /** Graceful process shutdown: running rows become exited before PTYs are torn down. */
  markAllRunningAsExited(): void {
    this.db.run(
      `UPDATE omni_agents SET status = 'exited', exit_code = NULL WHERE status = 'running'`,
    )
  }

  upsertRunning(row: {
    id: string
    cmd: string[]
    cwd: string
    configDir: string
    cols: number
    rows: number
    envExtra: Record<string, string> | undefined
  }): void {
    this.upsertStmt.run(
      row.id,
      JSON.stringify(row.cmd),
      row.cwd,
      row.configDir,
      row.cols,
      row.rows,
      row.envExtra !== undefined && Object.keys(row.envExtra).length > 0 ?
        JSON.stringify(row.envExtra)
      : null,
    )
  }

  updateExited(id: string, exitCode: number | null): void {
    this.updateExitedStmt.run(id, exitCode)
  }

  delete(id: string): void {
    this.deleteStmt.run(id)
  }

  loadAllExited(): PersistedAgentRow[] {
    const rows = this.selectAllStmt.all() as Array<{
      id: string
      cmd_json: string
      cwd: string
      config_dir: string
      cols: number
      rows: number
      env_json: string | null
      status: string
      exit_code: number | null
    }>
    const out: PersistedAgentRow[] = []
    for (const r of rows) {
      let cmd: string[]
      try {
        const parsed = JSON.parse(r.cmd_json) as unknown
        if (!Array.isArray(parsed) || !parsed.every(x => typeof x === 'string')) {
          throw new Error('cmd_json must be a string array')
        }
        cmd = parsed as string[]
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        throw new Error(`corrupt omni_agents row ${r.id}: ${msg}`)
      }
      let envExtra: Record<string, string> | null = null
      if (r.env_json !== null && r.env_json.trim() !== '') {
        try {
          const parsed = JSON.parse(r.env_json) as unknown
          if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
            envExtra = parsed as Record<string, string>
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          throw new Error(`corrupt omni_agents env_json for ${r.id}: ${msg}`)
        }
      }
      out.push({
        id: r.id,
        cmd,
        cwd: r.cwd,
        configDir: r.config_dir,
        cols: r.cols,
        rows: r.rows,
        envExtra,
        status: 'exited',
        exitCode: r.exit_code,
      })
    }
    return out
  }

  close(): void {
    this.db.close()
  }
}
