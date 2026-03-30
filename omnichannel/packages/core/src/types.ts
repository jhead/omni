/**
 * Pure domain types — no I/O, MCP, or transport imports.
 */

/** Use the workspace package name (no scope), e.g. `channel-webhook`, `channel-discord`. */
export type OmnichannelPluginId = 'channel-webhook' | 'channel-discord' | string

/** Normalized event the Gateway enqueues and the MCP host receives. */
export interface OmnichannelEvent {
  /** Stable id for dedup / tracing (queue row id). */
  id: string
  channelId: string
  plugin: OmnichannelPluginId
  /** ISO 8601 timestamp when the Gateway accepted the event. */
  receivedAt: string
  /** Normalized payload (e.g. webhook JSON body + selected headers). */
  payload: unknown
}

export interface CapabilityArgDef {
  type: 'string' | 'number' | 'boolean'
  required: boolean
  description?: string
}

export interface CapabilityDef {
  description?: string
  /** When true, caller must supply a replyHandle (capability acts on a specific prior message). */
  requiresReplyHandle: boolean
  args: Record<string, CapabilityArgDef>
}

/** Describes what a channel can do; used by `omni_context`. */
export interface CapabilitySet {
  channelId: string
  plugin: OmnichannelPluginId
  ingress: boolean
  egress: boolean
  capabilities: Record<string, CapabilityDef>
}
