export type LoggingConfig = {
  /** Log client JSON before proxy transforms (model, tools, thinking, …). */
  incomingRequest?: boolean;
  /** Log JSON sent to Anthropic after transforms. */
  outgoingRequest?: boolean;
  /**
   * @deprecated Same as `outgoingRequest`. If either is true, outgoing body is logged.
   */
  request?: boolean;
  /** Log upstream response: status, content-type, and body prefix (see maxBodyBytes). */
  response?: boolean;
  /** Max bytes to log for each JSON / response body capture. */
  maxBodyBytes?: number;
};

export type ProxyConfig = {
  listen: { hostname: string; port: number };
  upstreamBaseUrl: string;
  /**
   * When `true` or omitted, forward client `model` and `tools` unchanged (still proxies to `upstreamBaseUrl`).
   * When `false`, apply `model` override and `toolAllowlist` filtering (legacy filtered mode).
   * @default true
   */
  passthrough?: boolean;
  /** Routed model id when {@link passthrough} is `false`. Ignored in passthrough mode. */
  model?: string;
  /** Tool names allowed when {@link passthrough} is `false`. Ignored in passthrough mode. */
  toolAllowlist?: string[];
  logging?: LoggingConfig;
  /**
   * When the routed model matches an entry (exact, or id starts with `entry-` / `entry.`),
   * drop `thinking` if `type` is `adaptive`, and remove `output_config.effort`.
   */
  stripAdaptiveThinkingForModels?: string[];
};

export type ToolDef = { name: string; [key: string]: unknown };

export type MessagesBody = {
  model?: string;
  system?: unknown;
  tools?: ToolDef[];
  [key: string]: unknown;
};
