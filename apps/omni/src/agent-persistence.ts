import { Database } from 'bun:sqlite'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

import type { AgentTemplateRow, DeprecatedAgentsTemplateSeed } from './types.ts'

export const DEFAULT_AGENT_TEMPLATE_ID = 'default' as const

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

    this.db.run(`
      CREATE TABLE IF NOT EXISTS omni_agent_templates (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        is_system INTEGER NOT NULL CHECK (is_system IN (0, 1)),
        template_dir TEXT,
        claude_md TEXT,
        settings_json TEXT,
        default_cmd_json TEXT,
        default_cols INTEGER,
        default_rows INTEGER
      );
    `)
  }

  /**
   * Insert the `default` template if missing. Uses YAML deprecated seed when provided, else fallbacks.
   */
  ensureDefaultTemplateSeed(options: {
    deprecatedYaml?: DeprecatedAgentsTemplateSeed
    /** Relative path used when no YAML and no existing row (e.g. ../../reference/template). */
    fallbackTemplateDirRel: string
    fallbackDefaultCmd: [string, ...string[]]
    fallbackCols: number
    fallbackRows: number
  }): void {
    const row = this.db
      .prepare(`SELECT id FROM omni_agent_templates WHERE id = ?`)
      .get(DEFAULT_AGENT_TEMPLATE_ID) as { id: string } | undefined
    if (row) return

    const y = options.deprecatedYaml
    const templateDir =
      y?.templateDir !== undefined && y.templateDir !== null && y.templateDir.trim() !== '' ?
        y.templateDir
      : options.fallbackTemplateDirRel
    const defaultCmd = y?.defaultCmd ?? options.fallbackDefaultCmd
    const cols = y?.defaultCols ?? options.fallbackCols
    const rows = y?.defaultRows ?? options.fallbackRows

    this.db
      .prepare(
        `INSERT INTO omni_agent_templates (
          id, name, is_system, template_dir, claude_md, settings_json, default_cmd_json, default_cols, default_rows
        ) VALUES (?, ?, 1, ?, NULL, NULL, ?, ?, ?)`,
      )
      .run(
        DEFAULT_AGENT_TEMPLATE_ID,
        'Default',
        templateDir,
        JSON.stringify([...defaultCmd]),
        cols,
        rows,
      )
  }

  listTemplates(): AgentTemplateRow[] {
    const rows = this.db
      .prepare(
        `SELECT id, name, is_system, template_dir, claude_md, settings_json, default_cmd_json, default_cols, default_rows
         FROM omni_agent_templates ORDER BY is_system DESC, id`,
      )
      .all() as Array<{
      id: string
      name: string
      is_system: number
      template_dir: string | null
      claude_md: string | null
      settings_json: string | null
      default_cmd_json: string | null
      default_cols: number | null
      default_rows: number | null
    }>
    return rows.map(r => this.mapTemplateRow(r))
  }

  getTemplate(id: string): AgentTemplateRow | undefined {
    const r = this.db
      .prepare(
        `SELECT id, name, is_system, template_dir, claude_md, settings_json, default_cmd_json, default_cols, default_rows
         FROM omni_agent_templates WHERE id = ?`,
      )
      .get(id) as
      | {
          id: string
          name: string
          is_system: number
          template_dir: string | null
          claude_md: string | null
          settings_json: string | null
          default_cmd_json: string | null
          default_cols: number | null
          default_rows: number | null
        }
      | undefined
    return r ? this.mapTemplateRow(r) : undefined
  }

  insertTemplate(row: {
    id: string
    name: string
    templateDir?: string | null
    claudeMd?: string | null
    settingsJson?: Record<string, unknown> | null
    defaultCmd?: [string, ...string[]] | null
    defaultCols?: number | null
    defaultRows?: number | null
  }): void {
    const id = row.id.trim()
    if (id === DEFAULT_AGENT_TEMPLATE_ID) {
      throw new Error(`template id "${DEFAULT_AGENT_TEMPLATE_ID}" is reserved`)
    }
    if (!id) throw new Error('template id must be non-empty')
    this.db
      .prepare(
        `INSERT INTO omni_agent_templates (
          id, name, is_system, template_dir, claude_md, settings_json, default_cmd_json, default_cols, default_rows
        ) VALUES (?, ?, 0, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        row.name.trim() || id,
        row.templateDir ?? null,
        row.claudeMd ?? null,
        row.settingsJson !== undefined && row.settingsJson !== null ?
          JSON.stringify(row.settingsJson)
        : null,
        row.defaultCmd !== undefined && row.defaultCmd !== null ? JSON.stringify([...row.defaultCmd]) : null,
        row.defaultCols ?? null,
        row.defaultRows ?? null,
      )
  }

  updateTemplate(
    id: string,
    patch: Partial<{
      name: string
      templateDir: string | null
      claudeMd: string | null
      settingsJson: Record<string, unknown> | null
      defaultCmd: [string, ...string[]] | null
      defaultCols: number | null
      defaultRows: number | null
    }>,
  ): void {
    const existing = this.getTemplate(id)
    if (!existing) throw new Error(`unknown template: ${id}`)

    const name = patch.name !== undefined ? patch.name.trim() || id : existing.name
    const templateDir = patch.templateDir !== undefined ? patch.templateDir : existing.templateDir
    const claudeMd = patch.claudeMd !== undefined ? patch.claudeMd : existing.claudeMd
    const settingsJson =
      patch.settingsJson !== undefined ?
        patch.settingsJson === null ? null
        : patch.settingsJson
      : existing.settingsJson
    const defaultCmd = patch.defaultCmd !== undefined ? patch.defaultCmd : existing.defaultCmd
    const defaultCols = patch.defaultCols !== undefined ? patch.defaultCols : existing.defaultCols
    const defaultRows = patch.defaultRows !== undefined ? patch.defaultRows : existing.defaultRows

    this.db
      .prepare(
        `UPDATE omni_agent_templates SET
          name = ?2,
          template_dir = ?3,
          claude_md = ?4,
          settings_json = ?5,
          default_cmd_json = ?6,
          default_cols = ?7,
          default_rows = ?8
        WHERE id = ?1`,
      )
      .run(
        id,
        name,
        templateDir,
        claudeMd,
        settingsJson !== null && settingsJson !== undefined ? JSON.stringify(settingsJson) : null,
        defaultCmd !== null && defaultCmd !== undefined ? JSON.stringify([...defaultCmd]) : null,
        defaultCols,
        defaultRows,
      )
  }

  deleteTemplate(id: string): void {
    if (id === DEFAULT_AGENT_TEMPLATE_ID) {
      throw new Error(`cannot delete system template "${DEFAULT_AGENT_TEMPLATE_ID}"`)
    }
    const r = this.db.prepare(`DELETE FROM omni_agent_templates WHERE id = ?`).run(id)
    if (r.changes === 0) throw new Error(`unknown template: ${id}`)
  }

  private mapTemplateRow(r: {
    id: string
    name: string
    is_system: number
    template_dir: string | null
    claude_md: string | null
    settings_json: string | null
    default_cmd_json: string | null
    default_cols: number | null
    default_rows: number | null
  }): AgentTemplateRow {
    let settingsJson: Record<string, unknown> | null = null
    if (r.settings_json !== null && r.settings_json.trim() !== '') {
      const parsed = JSON.parse(r.settings_json) as unknown
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        settingsJson = parsed as Record<string, unknown>
      } else {
        throw new Error(`template ${r.id}: settings_json must be a JSON object`)
      }
    }
    let defaultCmd: [string, ...string[]] | null = null
    if (r.default_cmd_json !== null && r.default_cmd_json.trim() !== '') {
      const parsed = JSON.parse(r.default_cmd_json) as unknown
      if (!Array.isArray(parsed) || parsed.length === 0 || !parsed.every(x => typeof x === 'string')) {
        throw new Error(`template ${r.id}: default_cmd_json must be a non-empty string array`)
      }
      defaultCmd = [parsed[0] as string, ...(parsed.slice(1) as string[])]
    }
    return {
      id: r.id,
      name: r.name,
      isSystem: r.is_system === 1,
      templateDir: r.template_dir,
      claudeMd: r.claude_md,
      settingsJson,
      defaultCmd,
      defaultCols: r.default_cols,
      defaultRows: r.default_rows,
    }
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
