import type { ServerWebSocket } from 'bun'

import type { AgentManager } from './agent-manager.ts'

export interface AgentWsData {
  agentId: string
  unsub?: () => void
}

type BunWsHandler = {
  open(ws: ServerWebSocket<AgentWsData>): void
  message(ws: ServerWebSocket<AgentWsData>, message: string | Buffer): void
  close(ws: ServerWebSocket<AgentWsData>): void
}

export function createWsHandlers(agentManager: AgentManager): BunWsHandler {
  return {
    open(ws) {
      const { agentId } = ws.data
      const session = agentManager.getSession(agentId)
      if (!session) {
        ws.close(4004, 'unknown agent')
        return
      }
      try {
        const snap = session.getRawSnapshot()
        if (snap.length > 0) {
          ws.send(snap)
        }
      } catch {
        /* ignore snapshot errors */
      }
      const unsub = session.onOutput(chunk => {
        try {
          ws.send(chunk)
        } catch {
          unsub()
        }
      })
      ws.data.unsub = unsub
    },

    message(ws, message) {
      const { agentId } = ws.data
      const session = agentManager.getSession(agentId)
      if (!session) return

      const text =
        typeof message === 'string' ? message : new TextDecoder().decode(message as Buffer)

      try {
        const j = JSON.parse(text) as { type?: string; cols?: number; rows?: number }
        if (j && j.type === 'resize' && typeof j.cols === 'number' && typeof j.rows === 'number') {
          session.resize(j.cols, j.rows)
          return
        }
      } catch {
        /* not JSON — treat as raw input */
      }

      session.write(text)
    },

    close(ws) {
      ws.data.unsub?.()
    },
  }
}
