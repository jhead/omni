import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { Notification } from "@modelcontextprotocol/sdk/types.js";

import type { HttpServerDef, StdioServerDef } from "./types";

export type ConnectedBackend = {
  client: Client;
  transport: Transport;
};

async function connectHttpWithFallback(
  def: HttpServerDef,
  onNotification: (n: Notification) => void,
): Promise<ConnectedBackend> {
  const url = new URL(def.url);
  const requestInit: RequestInit = {
    headers: def.headers,
  };

  const tryStream = async (): Promise<ConnectedBackend> => {
    const client = new Client(
      { name: "omnitool-backend", version: "0.0.0" },
      {},
    );
    client.fallbackNotificationHandler = async (n: Notification) => {
      await onNotification(n);
    };
    const transport = new StreamableHTTPClientTransport(url, { requestInit });
    await client.connect(transport);
    return { client, transport };
  };

  try {
    return await tryStream();
  } catch (first: unknown) {
    const client = new Client(
      { name: "omnitool-backend", version: "0.0.0" },
      {},
    );
    client.fallbackNotificationHandler = async (n: Notification) => {
      await onNotification(n);
    };
    const transport = new SSEClientTransport(url, { requestInit });
    await client.connect(transport);
    return { client, transport };
  }
}

export async function connectStdioBackend(
  def: StdioServerDef,
  onNotification: (n: Notification) => void,
): Promise<ConnectedBackend> {
  const client = new Client(
    { name: "omnitool-backend", version: "0.0.0" },
    {},
  );
  client.fallbackNotificationHandler = async (n: Notification) => {
    await onNotification(n);
  };
  const transport = new StdioClientTransport({
    command: def.command,
    args: def.args,
    env: def.env,
    cwd: def.cwd,
  });
  await client.connect(transport);
  return { client, transport };
}

export async function connectBackend(
  type: "stdio" | "http",
  stdio: StdioServerDef | undefined,
  http: HttpServerDef | undefined,
  onNotification: (n: Notification) => void,
): Promise<ConnectedBackend> {
  if (type === "stdio") {
    if (!stdio) throw new Error("stdio config missing for stdio backend");
    return connectStdioBackend(stdio, onNotification);
  }
  if (!http) throw new Error("http config missing for http backend");
  return connectHttpWithFallback(http, onNotification);
}
