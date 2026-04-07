import type { OmniConfig } from './types.ts'

/**
 * When an agent-bus channel is configured, each MCP HTTP session can auto-subscribe to one topic
 * so agents hear each other without calling `subscribe` manually.
 */
export function resolveMcpAutoSubscribe(cfg: OmniConfig): { channelId: string; topic: string } | null {
  const busChannel = Object.entries(cfg.channels).find(([, c]) => c.plugin === 'channel-agent-bus')
  if (!busChannel) return null
  const [channelId] = busChannel
  const t = cfg.agents.agentBusAutoSubscribeTopic
  if (t === null) return null
  const topic = t === undefined ? 'omni-agents' : t
  return { channelId, topic }
}
