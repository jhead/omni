export type ListenConfig = {
  hostname: string;
  port: number;
};

/** stdio MCP server: command + args + optional env/cwd */
export type StdioServerDef = {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
};

/** Remote MCP server reachable over HTTP (Streamable HTTP preferred; SSE fallback). */
export type HttpServerDef = {
  /** Full URL to the MCP HTTP endpoint (e.g. http://127.0.0.1:3000/mcp) */
  url: string;
  /** Extra headers (e.g. Authorization) */
  headers?: Record<string, string>;
};

export type BackendServerEntry = {
  id: string;
} & (
  | { type: "stdio"; stdio: StdioServerDef }
  | { type: "http"; http: HttpServerDef }
);

export type OmnitoolRegistry = {
  listen: ListenConfig;
  /** Public path for Streamable HTTP MCP (e.g. /mcp) */
  mcpPath: string;
  /** Prefix between server id and original tool name (default __) */
  toolPrefixSeparator: string;
  servers: BackendServerEntry[];
};

export type BackendStateKind = "stopped" | "connecting" | "ready" | "error";

export type PerBackendStatus = {
  id: string;
  type: "stdio" | "http";
  state: BackendStateKind;
  lastError?: string;
  toolCount: number;
};

export type OmnitoolStatus = {
  startedAt: string;
  listen: ListenConfig;
  mcpPath: string;
  activeFrontSessions: number;
  backends: PerBackendStatus[];
};
