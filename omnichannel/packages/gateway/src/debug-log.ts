/**
 * Verbose stderr logging for `omnibot-gateway --debug`.
 */

import type { LoadedGatewayConfig } from './config.ts'

export interface GatewayDebugLogger {
  readonly enabled: boolean
  log(scope: string, message: string, detail?: unknown): void
}

function timestamp(): string {
  return new Date().toISOString()
}

function formatDetail(detail: unknown): string {
  if (detail === undefined) return ''
  if (typeof detail === 'string') return detail
  if (detail instanceof Error) return detail.stack ?? detail.message
  try {
    return JSON.stringify(detail, replacerSecretKeys, 2)
  } catch {
    return String(detail)
  }
}

function replacerSecretKeys(key: string, value: unknown): unknown {
  if (
    typeof value === 'string' &&
    /secret|token|password|authorization/i.test(key)
  ) {
    return value.length > 0 ? '(redacted)' : value
  }
  return value
}

export function createGatewayDebugLogger(enabled: boolean): GatewayDebugLogger {
  return {
    enabled,
    log(scope: string, message: string, detail?: unknown): void {
      if (!enabled) return
      const extra = detail !== undefined ? ` ${formatDetail(detail)}` : ''
      process.stderr.write(
        `[gateway:debug] ${timestamp()} [${scope}] ${message}${extra}\n`,
      )
    },
  }
}

/** Safe snapshot of config for logs (secrets redacted). */
export function summarizeConfigForDebug(
  cfg: LoadedGatewayConfig,
): Record<string, unknown> {
  return {
    configPath: cfg.configPath,
    gateway: JSON.parse(JSON.stringify(cfg.gateway, replacerSecretKeys)) as Record<
      string,
      unknown
    >,
    channels: cfg.channels,
    document: JSON.parse(JSON.stringify(cfg.document, replacerSecretKeys)),
  }
}
