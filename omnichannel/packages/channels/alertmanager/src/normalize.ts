/**
 * Alertmanager webhook payload (schema version 4) — normalized for Omnichannel / LLM context.
 * @see https://github.com/prometheus/alertmanager/blob/main/docs/configuration.md
 */

export const ALERTMANAGER_WEBHOOK_VERSION = 4 as const

/** One alert after normalization (subset of fields, string values only). */
export interface NormalizedAlertmanagerAlert {
  status: string
  labels: Record<string, string>
  annotations: Record<string, string>
  startsAt?: string
  endsAt?: string
  generatorURL?: string
  fingerprint?: string
}

/** Compact payload stored on `OmnichannelEvent.payload` for `channel-alertmanager`. */
export interface NormalizedAlertmanagerWebhookPayload {
  kind: 'alertmanager'
  version: typeof ALERTMANAGER_WEBHOOK_VERSION
  /** Human-readable block for notifications and quick scanning. */
  summary: string
  status: string
  receiver: string
  externalURL?: string
  groupKey?: string
  alerts: NormalizedAlertmanagerAlert[]
  /** Present when the original group had more alerts than included in `alerts`. */
  truncatedAlertCount?: number
}

export type NormalizeAlertmanagerWebhookResult =
  | { ok: true; value: NormalizedAlertmanagerWebhookPayload }
  | { ok: false; error: string }

const DEFAULT_MAX_ALERTS = 20
const DEFAULT_MAX_SUMMARY_CHARS = 12_000

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x)
}

function stringMap(x: unknown): Record<string, string> {
  if (!isRecord(x)) return {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(x)) {
    if (typeof v === 'string') out[k] = v
    else if (v != null) out[k] = String(v)
  }
  return out
}

function optionalString(x: unknown): string | undefined {
  if (x === undefined || x === null) return undefined
  if (typeof x === 'string') return x
  return String(x)
}

function truncateChars(s: string, max: number): string {
  if (s.length <= max) return s
  if (max <= 3) return s.slice(0, max)
  return `${s.slice(0, max - 3)}...`
}

export interface NormalizeAlertmanagerWebhookOptions {
  /** Max alerts to keep in `alerts` and to include lines in `summary` (default 20). */
  maxAlerts?: number
  /** Max length of `summary` (default 12000). */
  maxSummaryChars?: number
}

/**
 * Maps Alertmanager webhook JSON to a bounded, LLM-friendly payload.
 */
export function normalizeAlertmanagerWebhook(
  body: unknown,
  options?: NormalizeAlertmanagerWebhookOptions,
): NormalizeAlertmanagerWebhookResult {
  const maxAlerts = options?.maxAlerts ?? DEFAULT_MAX_ALERTS
  const maxSummaryChars = options?.maxSummaryChars ?? DEFAULT_MAX_SUMMARY_CHARS

  if (!isRecord(body)) {
    return { ok: false, error: 'body must be a JSON object' }
  }

  const rawAlerts = body.alerts
  if (!Array.isArray(rawAlerts)) {
    return { ok: false, error: 'missing or invalid alerts array' }
  }

  const receiver = optionalString(body.receiver) ?? ''
  const status = optionalString(body.status) ?? 'unknown'
  const externalURL = optionalString(body.externalURL)
  const groupKey = optionalString(body.groupKey)

  const totalRaw = rawAlerts.length
  const slice = rawAlerts.slice(0, maxAlerts)
  const truncatedAlertCount =
    totalRaw > slice.length ? totalRaw - slice.length : undefined

  const alerts: NormalizedAlertmanagerAlert[] = []
  for (const item of slice) {
    if (!isRecord(item)) continue
    alerts.push({
      status: optionalString(item.status) ?? 'unknown',
      labels: stringMap(item.labels),
      annotations: stringMap(item.annotations),
      startsAt: optionalString(item.startsAt),
      endsAt: optionalString(item.endsAt),
      generatorURL: optionalString(item.generatorURL),
      fingerprint: optionalString(item.fingerprint),
    })
  }

  const summary = buildSummary({
    receiver,
    status,
    externalURL,
    groupKey,
    alerts,
    truncatedAlertCount,
  })

  const value: NormalizedAlertmanagerWebhookPayload = {
    kind: 'alertmanager',
    version: ALERTMANAGER_WEBHOOK_VERSION,
    summary: truncateChars(summary, maxSummaryChars),
    status,
    receiver,
    ...(externalURL !== undefined ? { externalURL } : {}),
    ...(groupKey !== undefined ? { groupKey } : {}),
    alerts,
    ...(truncatedAlertCount !== undefined
      ? { truncatedAlertCount }
      : {}),
  }

  return { ok: true, value }
}

function buildSummary(input: {
  receiver: string
  status: string
  externalURL?: string
  groupKey?: string
  alerts: NormalizedAlertmanagerAlert[]
  truncatedAlertCount?: number
}): string {
  const lines: string[] = []
  lines.push(
    `[Alertmanager] receiver=${input.receiver || '(empty)'} status=${input.status}`,
  )
  if (input.groupKey) lines.push(`groupKey: ${input.groupKey}`)
  if (input.externalURL) lines.push(`externalURL: ${input.externalURL}`)
  if (input.truncatedAlertCount !== undefined && input.truncatedAlertCount > 0) {
    lines.push(
      `(truncated: ${input.truncatedAlertCount} more alert(s) not listed below)`,
    )
  }
  lines.push('')

  for (let i = 0; i < input.alerts.length; i++) {
    const a = input.alerts[i]
    if (!a) continue
    const name = a.labels.alertname ?? a.labels.alert ?? '(no alertname)'
    const sev = a.labels.severity
    const inst = a.labels.instance
    const job = a.labels.job
    lines.push(`--- alert ${i + 1} (${a.status}) ---`)
    lines.push(`  name: ${name}`)
    if (sev) lines.push(`  severity: ${sev}`)
    if (inst) lines.push(`  instance: ${inst}`)
    if (job) lines.push(`  job: ${job}`)
    const summ = a.annotations.summary ?? a.annotations.message
    const desc = a.annotations.description
    if (summ) lines.push(`  summary: ${summ}`)
    if (desc) lines.push(`  description: ${desc}`)
    if (a.generatorURL) lines.push(`  generatorURL: ${a.generatorURL}`)
    lines.push('')
  }

  return lines.join('\n').trimEnd()
}
