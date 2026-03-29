/**
 * YAML / env helpers for Discord — kept out of `@omnibot/gateway` so the gateway stays channel-agnostic.
 */

/** Token resolution from `omni.yaml` + env (used by the host process, not the gateway library). */
export interface DiscordTokenSource {
  discord?: { token?: string }
  gateway: { discordBotTokenEnv?: string }
  channels: Record<
    string,
    { plugin: string; token?: string; discordChannelId?: string }
  >
}

export function getDiscordBotToken(config: DiscordTokenSource): string | null {
  const top = config.discord?.token?.trim()
  if (top) return top

  for (const ch of Object.values(config.channels)) {
    if (ch.plugin === 'channel-discord' && ch.token?.trim()) {
      return ch.token.trim()
    }
  }

  const envName = config.gateway.discordBotTokenEnv ?? 'DISCORD_BOT_TOKEN'
  const fromEnv = process.env[envName]?.trim()
  return fromEnv || null
}

export function assertDiscordChannelsHaveIds(config: {
  channels: Record<string, { plugin: string; discordChannelId?: string }>
}): void {
  for (const [name, ch] of Object.entries(config.channels)) {
    if (ch.plugin === 'channel-discord' && !ch.discordChannelId?.trim()) {
      throw new Error(
        `omni.yaml: channels.${name} (channel-discord) requires discordChannelId`,
      )
    }
  }
}
