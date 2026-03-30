/** Mirrors gateway `ipc.ts` wire types (shared manually so `core` stays I/O-free). */

import type { CapabilitySet, OmnichannelEvent } from '@omnibot/core'

export type IpcInbound =
  | { type: 'hello'; token?: string; version?: number }
  | { type: 'get_context' }
  | { type: 'invoke'; id: string; channelId: string; capability: string; args: Record<string, unknown>; replyHandle?: string }

export type IpcOutbound =
  | { type: 'hello_ack' }
  | { type: 'error'; message: string }
  | { type: 'context'; channels: CapabilitySet[] }
  | { type: 'event'; event: OmnichannelEvent }
  | { type: 'invoke_result'; id: string; ok: boolean; data?: unknown; error?: string }
