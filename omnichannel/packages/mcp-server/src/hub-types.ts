/**
 * Structural type for in-process gateway hub access (implemented by `IpcHub` in `@omnibot/gateway`).
 * Defined here to avoid a package cycle with `@omnibot/gateway`.
 */

import type { CapabilitySet, OmnichannelEvent } from '@omnibot/core'

export type OmniHubInvokeResult =
  | { ok: true; data?: unknown }
  | { ok: false; error: string }

export type OmniHubInvokeInput = {
  id: string
  channelId: string
  capability: string
  args: Record<string, unknown>
  replyHandle?: string
}

export interface OmniMcpHubLike {
  getCapabilitiesSnapshot(): CapabilitySet[]
  invokeInProcess(input: OmniHubInvokeInput): Promise<OmniHubInvokeResult>
  subscribeEvents(listener: (event: OmnichannelEvent) => void): () => void
}
