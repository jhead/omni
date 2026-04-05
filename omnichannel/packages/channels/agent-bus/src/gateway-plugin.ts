import type { CapabilityDef, OmnichannelEvent } from '@omnibot/core'
import type {
  GatewayIo,
  GatewayPluginHost,
  GatewayPluginHostContext,
  InvokeContext,
  InvokeResult,
} from '@omnibot/gateway'

import { AgentBus, type BusMessage } from './bus.ts'

/** Injected by apps/omni before starting the gateway (not from YAML). */
export const OMNI_AGENT_BUS_KEY = '__omniAgentBus' as const

const CAPABILITIES: Record<string, CapabilityDef> = {
  publish: {
    description: 'Publish a message to a topic; all subscribers receive it via omnichannel events.',
    requiresReplyHandle: false,
    args: {
      topic: {
        type: 'string',
        required: true,
        description: 'Topic name.',
      },
      message: {
        type: 'string',
        required: false,
        description: 'JSON string or plain text; parsed as JSON when possible.',
      },
      payload: {
        type: 'string',
        required: false,
        description: 'Alternative to message for structured tool args (any JSON-serializable value may be passed by the host).',
      },
    },
  },
  subscribe: {
    description:
      'Subscribe this channel to a topic. Matching bus messages are delivered as omnichannel events.',
    requiresReplyHandle: false,
    args: {
      topic: {
        type: 'string',
        required: true,
        description: 'Topic name to subscribe to.',
      },
    },
  },
  list_topics: {
    description: 'List topics that currently have at least one subscriber.',
    requiresReplyHandle: false,
    args: {},
  },
}

function getBus(ctx: GatewayPluginHostContext): AgentBus | null {
  const raw = ctx.document[OMNI_AGENT_BUS_KEY]
  return raw instanceof AgentBus ? raw : null
}

function toEvent(channelId: string, msg: BusMessage): OmnichannelEvent {
  return {
    id: msg.id,
    channelId,
    plugin: 'channel-agent-bus',
    receivedAt: msg.timestamp,
    payload: {
      kind: 'agent-bus',
      topic: msg.topic,
      from: msg.from,
      body: msg.payload,
    },
  }
}

export function createGatewayPluginHost(
  _moduleExports: Record<string, unknown>,
  ctx: GatewayPluginHostContext,
): GatewayPluginHost {
  const dlog = ctx.debugLog
  let ioRef: GatewayIo | null = null
  /** Unsubscribe for each channelId + topic subscription */
  const subscriptionKeys = new Map<string, () => void>()

  const prepare = (): void => {
    const bus = getBus(ctx)
    dlog?.log('agent-bus', 'prepare', { hasBus: Boolean(bus) })
    if (!bus) {
      throw new Error(
        'channel-agent-bus: missing AgentBus on config document (__omniAgentBus). Set it in the host process before startGateway.',
      )
    }
  }

  const invoke = async (c: InvokeContext): Promise<InvokeResult | null> => {
    const bus = getBus(ctx)
    const io = ioRef
    if (!bus || !io) {
      return { ok: false, error: 'channel-agent-bus: bus or hub not ready' }
    }

    const row = ctx.channels[c.channelId]
    if (!row || row.plugin !== 'channel-agent-bus') {
      return null
    }

    if (c.capability === 'list_topics') {
      return { ok: true, data: { topics: bus.listTopics() } }
    }

    if (c.capability === 'subscribe') {
      const topic =
        typeof c.args.topic === 'string' && c.args.topic.trim() ? c.args.topic.trim() : ''
      if (!topic) {
        return { ok: false, error: 'channel-agent-bus: subscribe requires topic' }
      }
      const key = `${c.channelId}:${topic}`
      subscriptionKeys.get(key)?.()
      const unsub = bus.subscribe(topic, msg => {
        const event = toEvent(c.channelId, msg)
        io.hub.broadcast({ type: 'event', event })
      })
      subscriptionKeys.set(key, unsub)
      return { ok: true, data: { subscribed: topic } }
    }

    if (c.capability === 'publish') {
      const topic =
        typeof c.args.topic === 'string' && c.args.topic.trim() ? c.args.topic.trim() : ''
      if (!topic) {
        return { ok: false, error: 'channel-agent-bus: publish requires topic' }
      }
      let payload: unknown = c.args.message
      if (typeof payload === 'string' && payload.trim()) {
        try {
          payload = JSON.parse(payload) as unknown
        } catch {
          // keep raw string
        }
      } else if (c.args.payload !== undefined) {
        payload = c.args.payload
      }
      bus.publish(topic, c.channelId, payload)
      return { ok: true, data: { published: topic } }
    }

    return { ok: false, error: `channel-agent-bus: unknown capability ${c.capability}` }
  }

  return {
    capabilities: CAPABILITIES,
    prepare,
    async afterHubReady(io: GatewayIo): Promise<void> {
      ioRef = io
    },
    invoke,
  }
}
