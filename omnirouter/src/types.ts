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
  /** Routed model id for all requests. */
  model: string;
  /** Tool names allowed through; others are stripped from `tools`. */
  toolAllowlist: string[];
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
