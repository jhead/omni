/** Mirrors gateway `ipc.ts` wire types (shared manually so `core` stays I/O-free). */

import type { CapabilitySet, OmnichannelEvent } from '@omnichannel/core'

export type IpcInbound =
  | { type: 'hello'; token?: string; version?: number }
  | { type: 'get_context' }

export type IpcOutbound =
  | { type: 'hello_ack' }
  | { type: 'error'; message: string }
  | { type: 'context'; channels: CapabilitySet[] }
  | { type: 'event'; event: OmnichannelEvent }
