import { randomUUID } from 'node:crypto'

export interface BusMessage {
  id: string
  from: string
  topic: string
  payload: unknown
  timestamp: string
}

type Handler = (msg: BusMessage) => void

/**
 * In-memory pub/sub for cross-agent messaging. No persistence.
 */
export class AgentBus {
  private readonly topics = new Map<string, Set<Handler>>()

  publish(topic: string, from: string, payload: unknown): void {
    const t = topic.trim()
    if (!t) return
    const handlers = this.topics.get(t)
    if (!handlers || handlers.size === 0) return
    const msg: BusMessage = {
      id: randomUUID(),
      from,
      topic: t,
      payload,
      timestamp: new Date().toISOString(),
    }
    for (const h of handlers) {
      h(msg)
    }
  }

  subscribe(topic: string, handler: (msg: BusMessage) => void): () => void {
    const t = topic.trim()
    if (!t) {
      return () => {}
    }
    let set = this.topics.get(t)
    if (!set) {
      set = new Set()
      this.topics.set(t, set)
    }
    set.add(handler)
    return () => {
      const s = this.topics.get(t)
      if (!s) return
      s.delete(handler)
      if (s.size === 0) this.topics.delete(t)
    }
  }

  listTopics(): string[] {
    return [...this.topics.keys()].filter(t => {
      const s = this.topics.get(t)
      return s !== undefined && s.size > 0
    })
  }
}
