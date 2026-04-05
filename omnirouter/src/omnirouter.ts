import { createOmnirouterFetch } from "./handler";
import { mergeProxyConfigPartial } from "./mergeConfig";
import { emitLog, LOG_PREFIX, resolveLogging } from "./logging";
import type { ProxyConfig } from "./types";
import { validateProxyConfig } from "./validateConfig";

export type CreateOmnirouterOptions = {
  config: ProxyConfig;
  /**
   * When true (default), binds the HTTP server immediately.
   * When false, call {@link OmnirouterHandle.start} after any programmatic setup.
   */
  autoStart?: boolean;
};

export type OmnirouterHandle = {
  /** `Bun.Server.url` while running; `null` after {@link OmnirouterHandle.stop}. */
  readonly url: URL | null;
  readonly port: number;
  readonly hostname: string;
  readonly running: boolean;
  /** Deep clone of the effective in-memory config. */
  getConfig(): ProxyConfig;
  /** Replace config; if `listen` changes while running, the socket is rebound. */
  setConfig(config: ProxyConfig): void;
  /** Merge a partial update; if `listen` changes while running, the socket is rebound. */
  patchConfig(partial: Partial<ProxyConfig>): void;
  start(): void;
  stop(): void;
};

function listenKey(listen: ProxyConfig["listen"]): string {
  return `${listen.hostname}:${listen.port}`;
}

export function createOmnirouter(
  options: CreateOmnirouterOptions,
): OmnirouterHandle {
  let config: ProxyConfig = structuredClone(options.config);
  validateProxyConfig(config);

  let server: ReturnType<typeof Bun.serve> | null = null;

  const fetchHandler = createOmnirouterFetch(() => config);

  function logBind(): void {
    const base = config.upstreamBaseUrl.replace(/\/$/, "");
    const log = resolveLogging(config.logging);
    if (log.incomingRequest || log.outgoingRequest || log.response) {
      emitLog(
        `${LOG_PREFIX} bind ${config.listen.hostname}:${config.listen.port} → ${base} (model=${config.model})`,
      );
    } else {
      emitLog(
        `${LOG_PREFIX} listening ${config.listen.hostname}:${config.listen.port} → ${base} (model=${config.model})`,
      );
    }
  }

  function bind(): void {
    if (server) {
      server.stop();
      server = null;
    }
    server = Bun.serve({
      hostname: config.listen.hostname,
      port: config.listen.port,
      fetch: fetchHandler,
    });
    logBind();
  }

  function applyNewConfig(next: ProxyConfig, prevListen: ProxyConfig["listen"]): void {
    validateProxyConfig(next);
    const rebind = server !== null && listenKey(next.listen) !== listenKey(prevListen);
    config = next;
    if (rebind) {
      bind();
    }
  }

  const handle: OmnirouterHandle = {
    get url() {
      return server?.url ?? null;
    },
    get port() {
      return server?.port ?? config.listen.port;
    },
    get hostname() {
      return server?.hostname ?? config.listen.hostname;
    },
    get running() {
      return server !== null;
    },
    getConfig() {
      return structuredClone(config);
    },
    setConfig(next: ProxyConfig) {
      const prevListen = config.listen;
      applyNewConfig(structuredClone(next), prevListen);
    },
    patchConfig(partial: Partial<ProxyConfig>) {
      const prevListen = config.listen;
      const merged = mergeProxyConfigPartial(config, partial);
      applyNewConfig(merged, prevListen);
    },
    start() {
      if (server) {
        throw new Error("Omnirouter is already running");
      }
      bind();
    },
    stop() {
      if (server) {
        server.stop();
        server = null;
      }
    },
  };

  if (options.autoStart !== false) {
    handle.start();
  }

  return handle;
}
