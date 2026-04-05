import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import type { BackendRegistry } from "./backendRegistry";

export function createFrontServer(
  registry: BackendRegistry,
  separator: string,
): Server {
  const server = new Server(
    { name: "omnitool", version: "0.0.0" },
    {
      capabilities: {
        tools: { listChanged: true },
        logging: {},
      },
      instructions:
        `Aggregated MCP proxy. Each backend tool is named \`{backendId}${separator}{originalToolName}\`.`,
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return registry.listAggregatedTools(separator);
  });

  server.setRequestHandler(CallToolRequestSchema, async request => {
    return registry.callTool(
      request.params.name,
      request.params.arguments as Record<string, unknown> | undefined,
      separator,
    );
  });

  return server;
}
