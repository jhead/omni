export type {
  CapabilitySet,
  OmniDispatchAction,
  OmniDispatchArgs,
  OmniDispatchPayload,
  OmniDispatchValidationError,
  OmniDispatchValidationOk,
  OmniDispatchValidationResult,
  OmnichannelEvent,
  OmnichannelPluginId,
} from './types.ts'

export {
  getOmniDispatchJsonSchema,
  validateOmniDispatch,
} from './dispatch.ts'
