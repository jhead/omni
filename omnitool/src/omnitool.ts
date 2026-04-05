import { createAdminFetchHandler } from "./adminRoutes";
import { BackendRegistry } from "./backendRegistry";
import { FrontSessionRegistry } from "./frontSessionRegistry";
import { createMcpFetchHandler } from "./mcpFetch";
import { createFrontServer } from "./mcpFront";
import type { OmnitoolRegistry, OmnitoolStatus } from "./types";
import { mergeRegistryPartial, validateOmnitoolRegistry } from "./validateRegistry";

export type CreateOmnitoolOptions = {
  registry: OmnitoolRegistry;
  /**
   * When true (default), binds the HTTP server immediately.
   * When false, call {@link OmnitoolHandle.start} after programmatic setup.
   */
  autoStart?: boolean;
  /** Defaults to `process.env.OMNITOOL_ADMIN_TOKEN` when unset. */
  adminToken?: string;
};

export type OmnitoolHandle = {
  readonly url: URL | null;
  readonly port: number;
  readonly hostname: string;
  readonly running: boolean;
  getRegistry(): OmnitoolRegistry;
  setRegistry(config: OmnitoolRegistry): Promise<void>;
  patchRegistry(partial: Partial<OmnitoolRegistry>): Promise<void>;
  getStatus(): OmnitoolStatus;
  start(): Promise<void>;
  stop(): void;
};

export function createOmnitool(options: CreateOmnitoolOptions): OmnitoolHandle {
  let registry: OmnitoolRegistry = validateOmnitoolRegistry(
    structuredClone(options.registry),
  );

  const frontSessions = new FrontSessionRegistry();
  const backendRegistry: BackendRegistry = new BackendRegistry(
    async n => {
      await frontSessions.broadcast(n);
    },
  );

  const adminToken =
    options.adminToken ??
    (process.env.OMNITOOL_ADMIN_TOKEN?.trim() || undefined);

  const startedAt = new Date().toISOString();

  let server: ReturnType<typeof Bun.serve> | null = null;

  const getStatus = (): OmnitoolStatus => ({
    startedAt,
    listen: registry.listen,
    mcpPath: registry.mcpPath,
    activeFrontSessions: frontSessions.size,
    backends: backendRegistry.getStatus(),
  });

  function buildFetch(): (req: Request) => Response | Promise<Response> {
    const mcpHandler = createMcpFetchHandler({
      mcpPath: registry.mcpPath,
      createServer: () =>
        createFrontServer(backendRegistry, registry.toolPrefixSeparator),
      sessions: frontSessions,
    });

    const adminHandler = createAdminFetchHandler({
      getRegistry: () => registry,
      setRegistry: applyRegistry,
      getStatus,
      backendRegistry,
      adminToken,
      startedAt,
      listen: registry.listen,
      mcpPath: registry.mcpPath,
      frontSessionCount: () => frontSessions.size,
    });

    return (req: Request): Response | Promise<Response> => {
      const url = new URL(req.url);
      const p = url.pathname;
      if (p === "/status" || p === "/registry" || p.startsWith("/registry/")) {
        return adminHandler(req);
      }
      if (p === registry.mcpPath) {
        return mcpHandler(req);
      }
      return new Response("Not Found\n", { status: 404 });
    };
  }

  async function applyRegistry(next: OmnitoolRegistry): Promise<void> {
    registry = validateOmnitoolRegistry(structuredClone(next));

    if (server !== null) {
      server.stop();
      server = Bun.serve({
        hostname: registry.listen.hostname,
        port: registry.listen.port,
        fetch: buildFetch(),
      });
    }

    await backendRegistry.syncFromConfig(registry.servers);
    await frontSessions.notifyToolListChanged();
  }

  const handle: OmnitoolHandle = {
    get url() {
      return server?.url ?? null;
    },
    get port() {
      return server?.port ?? registry.listen.port;
    },
    get hostname() {
      return server?.hostname ?? registry.listen.hostname;
    },
    get running() {
      return server !== null;
    },
    getRegistry() {
      return structuredClone(registry);
    },
    async setRegistry(config: OmnitoolRegistry) {
      await applyRegistry(config);
    },
    async patchRegistry(partial: Partial<OmnitoolRegistry>) {
      const merged = mergeRegistryPartial(registry, partial);
      await applyRegistry(merged);
    },
    getStatus,
    async start() {
      if (server) {
        throw new Error("Omnitool is already running");
      }
      server = Bun.serve({
        hostname: registry.listen.hostname,
        port: registry.listen.port,
        fetch: buildFetch(),
      });
      await backendRegistry.syncFromConfig(registry.servers);
    },
    stop() {
      if (server) {
        server.stop();
        server = null;
      }
    },
  };

  if (options.autoStart !== false) {
    handle.start().catch(err => {
      console.error("omnitool: failed to start:", err);
      process.exit(1);
    });
  }

  return handle;
}
