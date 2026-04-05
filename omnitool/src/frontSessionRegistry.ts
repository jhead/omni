import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { Notification } from "@modelcontextprotocol/sdk/types.js";

/**
 * One {@link Server} per Streamable HTTP session; broadcast backend notifications to all.
 */
export class FrontSessionRegistry {
  private readonly servers = new Set<Server>();

  add(server: Server): void {
    this.servers.add(server);
  }

  remove(server: Server): void {
    this.servers.delete(server);
  }

  get size(): number {
    return this.servers.size;
  }

  async notifyToolListChanged(): Promise<void> {
    for (const s of this.servers) {
      try {
        await s.sendToolListChanged();
      } catch (e) {
        console.error("omnitool: sendToolListChanged failed:", e);
      }
    }
  }

  async broadcast(notification: Notification): Promise<void> {
    const params =
      notification && typeof notification === "object" && "params" in notification
        ? (notification as { params?: unknown }).params
        : undefined;
    const method = (notification as { method: string }).method;
    for (const s of this.servers) {
      try {
        await s.notification({
          method,
          params: params as Record<string, unknown> | undefined,
        });
      } catch (e) {
        console.error(
          `omnitool: failed to forward notification ${JSON.stringify(method)}:`,
          e,
        );
      }
    }
  }
}
