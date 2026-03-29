/**
 * Core contract tests — PLAN §6 `omni_dispatch` surface (validateOmniDispatch + schema).
 * Success criteria: valid payloads per action; rejects wrong args, extra keys, missing fields.
 *
 * PLAN §6 describes replyHandle as a short ID (e.g. &lt; 20 chars). The exported JSON Schema
 * currently uses maxLength 64 — tests assert the live schema via getOmniDispatchJsonSchema()
 * for bounds; prefer handles under 20 chars in examples to match PLAN intent.
 */
import { describe, expect, test } from 'bun:test'

import {
  getOmniDispatchJsonSchema,
  validateOmniDispatch,
} from './dispatch.ts'

const schema = getOmniDispatchJsonSchema()
const replyMax =
  typeof schema.properties?.replyHandle === 'object' &&
  schema.properties.replyHandle !== null &&
  'maxLength' in schema.properties.replyHandle
    ? (schema.properties.replyHandle as { maxLength: number }).maxLength
    : 64

function validPayload(
  action: 'reply',
  extra: { replyHandle?: string; args: { text: string } },
): Record<string, unknown>
function validPayload(
  action: 'react',
  extra: { replyHandle?: string; args: { emoji: string } },
): Record<string, unknown>
function validPayload(
  action: 'ack' | 'resolve' | 'noop',
  extra?: { replyHandle?: string; args?: Record<string, never> },
): Record<string, unknown>
function validPayload(
  action: string,
  extra: { replyHandle?: string; args?: Record<string, unknown> } = {},
): Record<string, unknown> {
  const replyHandle = extra.replyHandle ?? 'omni_7xP2mQ'
  const args = extra.args ?? {}
  return { replyHandle, action, args }
}

describe('phase0 core — omni_dispatch validation (PLAN §6)', () => {
  test('accepts reply with non-empty text', () => {
    const r = validateOmniDispatch(
      validPayload('reply', { args: { text: 'hello' } }),
    )
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.action).toBe('reply')
      expect(r.value.args).toEqual({ text: 'hello' })
    }
  })

  test('accepts react with non-empty emoji', () => {
    const r = validateOmniDispatch(
      validPayload('react', { args: { emoji: '👍' } }),
    )
    expect(r.ok).toBe(true)
  })

  test('accepts ack with empty args object', () => {
    const r = validateOmniDispatch(validPayload('ack', { args: {} }))
    expect(r.ok).toBe(true)
  })

  test('accepts resolve with empty args object', () => {
    const r = validateOmniDispatch(validPayload('resolve', { args: {} }))
    expect(r.ok).toBe(true)
  })

  test('accepts noop with empty args object', () => {
    const r = validateOmniDispatch(validPayload('noop', { args: {} }))
    expect(r.ok).toBe(true)
  })

  test('PLAN-style short replyHandle (under 20 chars) is valid', () => {
    const r = validateOmniDispatch(
      validPayload('noop', { replyHandle: 'omni_abc12', args: {} }),
    )
    expect(r.ok).toBe(true)
  })

  test(`rejects replyHandle longer than schema maxLength (${replyMax})`, () => {
    const long = 'x'.repeat(replyMax + 1)
    const r = validateOmniDispatch(
      validPayload('noop', { replyHandle: long, args: {} }),
    )
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.errors.some(e => e.includes('replyHandle') || e.includes('must NOT have'))).toBe(
        true,
      )
    }
  })

  test('rejects missing replyHandle', () => {
    const r = validateOmniDispatch({ action: 'noop', args: {} })
    expect(r.ok).toBe(false)
  })

  test('rejects missing action', () => {
    const r = validateOmniDispatch({ replyHandle: 'omni_x', args: {} })
    expect(r.ok).toBe(false)
  })

  test('rejects missing args', () => {
    const r = validateOmniDispatch({
      replyHandle: 'omni_x',
      action: 'noop',
    })
    expect(r.ok).toBe(false)
  })

  test('rejects extra top-level keys (additionalProperties: false)', () => {
    const r = validateOmniDispatch({
      replyHandle: 'omni_x',
      action: 'noop',
      args: {},
      extra: 1,
    })
    expect(r.ok).toBe(false)
  })

  test('rejects reply without text in args', () => {
    const r = validateOmniDispatch({
      replyHandle: 'omni_x',
      action: 'reply',
      args: {},
    })
    expect(r.ok).toBe(false)
  })

  test('rejects reply with empty text', () => {
    const r = validateOmniDispatch({
      replyHandle: 'omni_x',
      action: 'reply',
      args: { text: '' },
    })
    expect(r.ok).toBe(false)
  })

  test('rejects react without emoji', () => {
    const r = validateOmniDispatch({
      replyHandle: 'omni_x',
      action: 'react',
      args: {},
    })
    expect(r.ok).toBe(false)
  })

  test('rejects wrong action enum value', () => {
    const r = validateOmniDispatch({
      replyHandle: 'omni_x',
      action: 'delete',
      args: {},
    })
    expect(r.ok).toBe(false)
  })

  test('rejects ack with unexpected args property', () => {
    const r = validateOmniDispatch({
      replyHandle: 'omni_x',
      action: 'ack',
      args: { foo: 'bar' },
    })
    expect(r.ok).toBe(false)
  })
})
