import { randomUUID } from "node:crypto";

import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";

import type { FrontSessionRegistry } from "./frontSessionRegistry";

export type McpRouteContext = {
  mcpPath: string;
  createServer: () => Server;
  sessions: FrontSessionRegistry;
};

function getSessionHeader(req: Request): string | undefined {
  return req.headers.get("mcp-session-id") ?? undefined;
}

/**
 * Streamable HTTP MCP: POST (initialize + JSON-RPC), GET (SSE), DELETE (session end).
 */
export function createMcpFetchHandler(ctx: McpRouteContext): (req: Request) => Promise<Response> {
  const transports = new Map<string, WebStandardStreamableHTTPServerTransport>();

  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    if (url.pathname !== ctx.mcpPath) {
      return new Response("Not Found\n", { status: 404 });
    }

    const sessionHeader = getSessionHeader(req);

    if (req.method === "POST") {
      const text = await req.text();
      let parsedBody: unknown;
      try {
        parsedBody = text ? JSON.parse(text) : undefined;
      } catch {
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            error: { code: -32700, message: "Parse error" },
            id: null,
          }),
          { status: 400, headers: { "content-type": "application/json" } },
        );
      }

      if (sessionHeader && transports.has(sessionHeader)) {
        const tr = transports.get(sessionHeader)!;
        const reqForTransport = new Request(req.url, {
          method: req.method,
          headers: req.headers,
          body: text,
        });
        return tr.handleRequest(reqForTransport, { parsedBody });
      }

      if (!sessionHeader && isInitializeRequest(parsedBody)) {
        const server = ctx.createServer();
        const transport = new WebStandardStreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: async sid => {
            transports.set(sid, transport);
            ctx.sessions.add(server);
          },
          onsessionclosed: async sid => {
            transports.delete(sid);
            ctx.sessions.remove(server);
            try {
              await server.close();
            } catch (e) {
              console.error(`omnitool: close server for session ${sid}: ${e}`);
            }
          },
        });
        transport.onclose = () => {
          const sid = transport.sessionId;
          if (sid && transports.has(sid)) {
            transports.delete(sid);
          }
          ctx.sessions.remove(server);
        };
        await server.connect(transport);
        const reqForTransport = new Request(req.url, {
          method: req.method,
          headers: req.headers,
          body: text,
        });
        return transport.handleRequest(reqForTransport, { parsedBody });
      }

      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          error: {
            code: -32000,
            message:
              "Bad Request: expected initialize without session, or a valid Mcp-Session-Id",
          },
          id: null,
        }),
        { status: 400, headers: { "content-type": "application/json" } },
      );
    }

    if (req.method === "GET" || req.method === "DELETE") {
      if (!sessionHeader || !transports.has(sessionHeader)) {
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            error: { code: -32001, message: "Session not found" },
            id: null,
          }),
          { status: 404, headers: { "content-type": "application/json" } },
        );
      }
      const tr = transports.get(sessionHeader)!;
      return tr.handleRequest(req);
    }

    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Method not allowed" },
        id: null,
      }),
      { status: 405, headers: { "content-type": "application/json" } },
    );
  };
}
