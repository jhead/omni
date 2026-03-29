/**
 * Alertmanager channel — HTTP ingress for `plugin: channel-alertmanager`.
 */

export { createGatewayPluginHost } from './gateway-plugin.ts'
export {
  ALERTMANAGER_PATH_PREFIX,
  handleAlertmanagerPost,
  type AlertmanagerIngressContext,
  type AlertmanagerIngressHooks,
  type ResolvedAlertmanagerChannel,
} from './alertmanager-ingress.ts'
export {
  ALERTMANAGER_WEBHOOK_VERSION,
  normalizeAlertmanagerWebhook,
  type NormalizedAlertmanagerAlert,
  type NormalizedAlertmanagerWebhookPayload,
  type NormalizeAlertmanagerWebhookOptions,
  type NormalizeAlertmanagerWebhookResult,
} from './normalize.ts'
