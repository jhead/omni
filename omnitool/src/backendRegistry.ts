import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import type { CallToolResult, Notification, Tool } from "@modelcontextprotocol/sdk/types.js";

import { connectBackend } from "./backend";
import { parsePrefixedToolName, prefixToolList } from "./aggregateTools";
import { AsyncMutex } from "./mutex";
import type {
  BackendServerEntry,
  PerBackendStatus,
} from "./types";

type LiveBackend = {
  entry: BackendServerEntry;
  client?: Client;
  state: "ready" | "error";
  lastError?: string;
  toolCount: number;
};

export type NotificationBroadcaster = (n: Notification) => Promise<void>;

export class BackendRegistry {
  readonly mutex = new AsyncMutex();
  private backends = new Map<string, LiveBackend>();
  private readonly broadcast: NotificationBroadcaster;

  constructor(broadcast: NotificationBroadcaster) {
    this.broadcast = broadcast;
  }

  getStatus(): PerBackendStatus[] {
    return [...this.backends.values()].map(b => ({
      id: b.entry.id,
      type: b.entry.type,
      state: b.state === "ready" ? "ready" : "error",
      lastError: b.lastError,
      toolCount: b.toolCount,
    }));
  }

  async syncFromConfig(servers: BackendServerEntry[]): Promise<void> {
    await this.mutex.run(async () => {
      const nextIds = new Set(servers.map(s => s.id));
      for (const id of this.backends.keys()) {
        if (!nextIds.has(id)) {
          await this.removeBackendLocked(id);
        }
      }
      for (const entry of servers) {
        const cur = this.backends.get(entry.id);
        if (!cur) {
          await this.addBackendLocked(entry);
        } else if (
          JSON.stringify(stableSerialize(entry)) !==
          JSON.stringify(stableSerialize(cur.entry))
        ) {
          await this.removeBackendLocked(entry.id);
          await this.addBackendLocked(entry);
        }
      }
    });
  }

  async listAggregatedTools(separator: string): Promise<{ tools: Tool[] }> {
    return this.mutex.run(async () => {
      const tools: Tool[] = [];
      const used = new Set<string>();
      for (const [id, b] of this.backends) {
        if (b.state !== "ready" || !b.client) continue;
        try {
          const r = await b.client.listTools();
          tools.push(...prefixToolList(id, r.tools, separator, used));
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          b.state = "error";
          b.lastError = msg;
          b.toolCount = 0;
        }
      }
      return { tools };
    });
  }

  async callTool(
    prefixedName: string,
    args: Record<string, unknown> | undefined,
    separator: string,
  ): Promise<CallToolResult> {
    return this.mutex.run(async () => {
      const ids = new Set(this.backends.keys());
      const parsed = parsePrefixedToolName(prefixedName, separator, ids);
      if (!parsed) {
        throw new McpError(
          ErrorCode.InvalidParams,
          `Unknown tool or bad prefix: ${JSON.stringify(prefixedName)}`,
        );
      }
      const b = this.backends.get(parsed.serverId);
      if (!b || b.state !== "ready" || !b.client) {
        throw new McpError(
          ErrorCode.InvalidParams,
          `Backend not available: ${JSON.stringify(parsed.serverId)}`,
        );
      }
      const result = await b.client.callTool({
        name: parsed.originalName,
        arguments: args,
      });
      return result as CallToolResult;
    });
  }

  private async addBackendLocked(entry: BackendServerEntry): Promise<void> {
    try {
      const { client } = await connectBackend(
        entry.type,
        entry.type === "stdio" ? entry.stdio : undefined,
        entry.type === "http" ? entry.http : undefined,
        n => this.broadcast(n),
      );
      const listed = await client.listTools();
      this.backends.set(entry.id, {
        entry,
        client,
        state: "ready",
        toolCount: listed.tools.length,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.backends.set(entry.id, {
        entry,
        state: "error",
        lastError: msg,
        toolCount: 0,
      });
    }
  }

  private async removeBackendLocked(id: string): Promise<void> {
    const b = this.backends.get(id);
    if (!b) return;
    this.backends.delete(id);
    if (b.client) {
      try {
        await b.client.close();
      } catch {
        /* */
      }
    }
  }
}

function stableSerialize(entry: BackendServerEntry): unknown {
  if (entry.type === "stdio") {
    return { id: entry.id, type: "stdio", stdio: entry.stdio };
  }
  return { id: entry.id, type: "http", http: entry.http };
}
