/**
 * Webhook channel — HTTP ingress for `plugin: channel-webhook` (and future path/auth hooks).
 * Gateway owns the raw TCP/HTTP server; this package handles `/webhooks/:channelId` semantics only.
 */

export { createGatewayPluginHost } from './gateway-plugin.ts'
export {
  WEBHOOK_PATH_PREFIX,
  handleWebhookPost,
  type WebhookIngressContext,
  type WebhookIngressHooks,
} from './webhook-ingress.ts'
