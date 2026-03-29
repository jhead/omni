import { describe, expect, test } from 'bun:test'

import { normalizeAlertmanagerWebhook } from './normalize.ts'

function sampleWebhook(): Record<string, unknown> {
  return {
    receiver: 'omni',
    status: 'firing',
    alerts: [
      {
        status: 'firing',
        labels: {
          alertname: 'HighErrorRate',
          severity: 'critical',
          instance: '10.0.0.1:9090',
        },
        annotations: {
          summary: 'Error rate high',
          description: 'More than 5% errors in 5m',
        },
        startsAt: '2024-01-01T12:00:00Z',
        endsAt: '0001-01-01T00:00:00Z',
        generatorURL: 'http://prometheus/graph',
        fingerprint: 'abc123',
      },
    ],
    groupLabels: { alertname: 'HighErrorRate' },
    externalURL: 'http://alertmanager:9093',
    groupKey: '{}:{alertname="HighErrorRate"}',
    version: '4',
  }
}

describe('normalizeAlertmanagerWebhook', () => {
  test('accepts valid v4-style payload', () => {
    const r = normalizeAlertmanagerWebhook(sampleWebhook())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const v = r.value
    expect(v.kind).toBe('alertmanager')
    expect(v.version).toBe(4)
    expect(v.receiver).toBe('omni')
    expect(v.status).toBe('firing')
    expect(v.externalURL).toBe('http://alertmanager:9093')
    expect(v.groupKey).toBe('{}:{alertname="HighErrorRate"}')
    expect(v.alerts).toHaveLength(1)
    expect(v.alerts[0]?.labels.alertname).toBe('HighErrorRate')
    expect(v.summary).toContain('HighErrorRate')
    expect(v.summary).toContain('Error rate high')
    expect(v.truncatedAlertCount).toBeUndefined()
  })

  test('empty alerts array is valid', () => {
    const r = normalizeAlertmanagerWebhook({
      receiver: 'r',
      status: 'resolved',
      alerts: [],
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.alerts).toEqual([])
    expect(r.value.summary).toContain('resolved')
  })

  test('truncates when alerts exceed maxAlerts', () => {
    const alerts = Array.from({ length: 25 }, (_, i) => ({
      status: 'firing',
      labels: { alertname: `Alert${i}` },
      annotations: {},
    }))
    const r = normalizeAlertmanagerWebhook(
      { receiver: 'x', status: 'firing', alerts },
      { maxAlerts: 5 },
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.alerts).toHaveLength(5)
    expect(r.value.truncatedAlertCount).toBe(20)
    expect(r.value.summary).toContain('truncated: 20')
  })

  test('rejects non-object body', () => {
    const r = normalizeAlertmanagerWebhook(null)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toMatch(/object/)
  })

  test('rejects missing alerts array', () => {
    const r = normalizeAlertmanagerWebhook({ receiver: 'r' })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toMatch(/alerts/)
  })

  test('summary respects maxSummaryChars', () => {
    const long = 'x'.repeat(50_000)
    const r = normalizeAlertmanagerWebhook(
      {
        receiver: 'r',
        status: 'firing',
        alerts: [
          {
            status: 'firing',
            labels: { alertname: 'A' },
            annotations: { summary: long },
          },
        ],
      },
      { maxSummaryChars: 100 },
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.summary.length).toBeLessThanOrEqual(100)
    expect(r.value.summary.endsWith('...')).toBe(true)
  })

  test('skips non-object alert entries', () => {
    const goodAlert = {
      status: 'firing',
      labels: { alertname: 'Keep' },
      annotations: {},
    }
    const r = normalizeAlertmanagerWebhook({
      receiver: 'r',
      status: 'firing',
      alerts: [null, 'bad', goodAlert],
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.alerts).toHaveLength(1)
  })
})
