import type { CapabilitySet, OmniDispatchAction, OmnichannelPluginId } from './types.ts'

function actionsForPlugin(plugin: string): OmniDispatchAction[] {
  if (plugin === 'channel-webhook') return ['noop']
  if (plugin === 'channel-discord') return ['reply', 'react', 'ack', 'noop']
  return ['reply', 'react', 'ack', 'resolve', 'noop']
}

function capabilityForChannel(
  channelId: string,
  plugin: string,
): CapabilitySet {
  const ingress = true
  const egress = plugin !== 'channel-webhook'
  return {
    channelId,
    plugin: plugin as OmnichannelPluginId,
    ingress,
    egress,
    actions: actionsForPlugin(plugin),
  }
}

/** Builds MCP `omni_context` capability rows from channel plugin ids. */
export function getCapabilitySetsForChannels(
  channels: Record<string, { plugin: string }>,
): CapabilitySet[] {
  return Object.entries(channels).map(([channelId, ch]) =>
    capabilityForChannel(channelId, ch.plugin),
  )
}
