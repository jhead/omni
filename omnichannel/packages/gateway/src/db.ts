import { Database } from 'bun:sqlite'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

import type { OmnichannelEvent } from '@omnichannel/core'

export function openDatabase(dbPath: string): Database {
  const dir = dirname(dbPath)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  const db = new Database(dbPath)
  db.run(`
    CREATE TABLE IF NOT EXISTS ingress_queue (
      id TEXT PRIMARY KEY NOT NULL,
      channel_id TEXT NOT NULL,
      event_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ingress_expires ON ingress_queue (expires_at);
  `)
  return db
}

export function insertQueuedEvent(
  db: Database,
  event: OmnichannelEvent,
  expiresAt: number,
): void {
  db.run(
    `INSERT INTO ingress_queue (id, channel_id, event_json, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?)`,
    [
      event.id,
      event.channelId,
      JSON.stringify(event),
      Date.now(),
      expiresAt,
    ],
  )
}

export function deleteQueuedEvent(db: Database, id: string): void {
  db.run(`DELETE FROM ingress_queue WHERE id = ?`, [id])
}

export function gcExpired(db: Database, now: number): number {
  const q = db.query(`DELETE FROM ingress_queue WHERE expires_at < ?`).run(now)
  return Number(q.changes ?? 0)
}

export function listPendingEvents(db: Database, now: number): OmnichannelEvent[] {
  const rows = db
    .query(
      `SELECT event_json FROM ingress_queue WHERE expires_at >= ? ORDER BY created_at ASC`,
    )
    .all(now) as { event_json: string }[]
  return rows.map(r => JSON.parse(r.event_json) as OmnichannelEvent)
}
