import Ajv, { type ErrorObject } from 'ajv'

import type {
  OmniDispatchPayload,
  OmniDispatchValidationResult,
} from './types.ts'

/**
 * `omni_dispatch` — discriminated union: `action` selects `args` shape.
 * Matches PLAN.md: replyHandle + action + args validated via oneOf.
 */

const dispatchSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['replyHandle', 'action', 'args'],
  properties: {
    replyHandle: { type: 'string', maxLength: 64 },
    action: {
      type: 'string',
      enum: ['reply', 'react', 'ack', 'resolve', 'noop'],
    },
    args: { type: 'object' },
  },
  oneOf: [
    {
      type: 'object',
      required: ['replyHandle', 'action', 'args'],
      properties: {
        replyHandle: { type: 'string', maxLength: 64 },
        action: { const: 'reply' },
        args: {
          type: 'object',
          additionalProperties: false,
          required: ['text'],
          properties: { text: { type: 'string', minLength: 1 } },
        },
      },
    },
    {
      type: 'object',
      required: ['replyHandle', 'action', 'args'],
      properties: {
        replyHandle: { type: 'string', maxLength: 64 },
        action: { const: 'react' },
        args: {
          type: 'object',
          additionalProperties: false,
          required: ['emoji'],
          properties: { emoji: { type: 'string', minLength: 1 } },
        },
      },
    },
    {
      type: 'object',
      required: ['replyHandle', 'action', 'args'],
      properties: {
        replyHandle: { type: 'string', maxLength: 64 },
        action: { const: 'ack' },
        args: { type: 'object', additionalProperties: false },
      },
    },
    {
      type: 'object',
      required: ['replyHandle', 'action', 'args'],
      properties: {
        replyHandle: { type: 'string', maxLength: 64 },
        action: { const: 'resolve' },
        args: { type: 'object', additionalProperties: false },
      },
    },
    {
      type: 'object',
      required: ['replyHandle', 'action', 'args'],
      properties: {
        replyHandle: { type: 'string', maxLength: 64 },
        action: { const: 'noop' },
        args: { type: 'object', additionalProperties: false },
      },
    },
  ],
} as const

const ajv = new Ajv({ allErrors: true, strict: false })
const validate = ajv.compile(dispatchSchema)

function formatAjvErrors(errors: ErrorObject[] | null | undefined): string[] {
  if (!errors?.length) return ['Invalid payload']
  return errors.map(e => {
    const path = e.instancePath || '(root)'
    return `${path} ${e.message ?? 'invalid'}`
  })
}

export function validateOmniDispatch(
  input: unknown,
): OmniDispatchValidationResult {
  if (validate(input)) {
    const v = input as OmniDispatchPayload
    return { ok: true, value: v }
  }
  return { ok: false, errors: formatAjvErrors(validate.errors) }
}

export function getOmniDispatchJsonSchema(): typeof dispatchSchema {
  return dispatchSchema
}
