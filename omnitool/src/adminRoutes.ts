import type { BackendRegistry } from "./backendRegistry";
import type { OmnitoolRegistry, OmnitoolStatus } from "./types";
import {
  mergeRegistryPartial,
  validateOmnitoolRegistry,
  validateServerEntry,
} from "./validateRegistry";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function checkAdmin(req: Request, token: string | undefined): Response | null {
  if (!token) return null;
  const auth = req.headers.get("authorization");
  const expected = `Bearer ${token}`;
  if (auth !== expected) {
    return json({ error: "Unauthorized" }, 401);
  }
  return null;
}

export type AdminRouterContext = {
  getRegistry: () => OmnitoolRegistry;
  setRegistry: (r: OmnitoolRegistry) => Promise<void>;
  getStatus: () => OmnitoolStatus;
  backendRegistry: BackendRegistry;
  adminToken: string | undefined;
  startedAt: string;
  listen: { hostname: string; port: number };
  mcpPath: string;
  frontSessionCount: () => number;
};

export function createAdminFetchHandler(
  ctx: AdminRouterContext,
): (req: Request) => Response | Promise<Response> {
  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const path = url.pathname;

    const unauthorized = checkAdmin(req, ctx.adminToken);
    if (unauthorized) return unauthorized;

    if (path === "/status" && req.method === "GET") {
      return json(ctx.getStatus());
    }

    if (path === "/registry" && req.method === "GET") {
      const r = ctx.getRegistry();
      const backends = ctx.backendRegistry.getStatus();
      return json({
        registry: r,
        backends,
      });
    }

    /** Replace entire registry document. */
    if (path === "/registry" && req.method === "PUT") {
      const body = (await req.json()) as unknown;
      const r = validateOmnitoolRegistry(body);
      await ctx.setRegistry(r);
      return json({ ok: true, registry: ctx.getRegistry() });
    }

    /** Append one backend server. */
    if (path === "/registry" && req.method === "POST") {
      const body = (await req.json()) as unknown;
      const entry = validateServerEntry(body);
      const cur = ctx.getRegistry();
      if (cur.servers.some(s => s.id === entry.id)) {
        return json({ error: "id already exists", id: entry.id }, 409);
      }
      const next = { ...cur, servers: [...cur.servers, entry] };
      await ctx.setRegistry(validateOmnitoolRegistry(next));
      return json({ ok: true, registry: ctx.getRegistry() });
    }

    if (path === "/registry" && req.method === "PATCH") {
      const body = (await req.json()) as Partial<OmnitoolRegistry>;
      const merged = mergeRegistryPartial(ctx.getRegistry(), body);
      await ctx.setRegistry(merged);
      return json({ ok: true, registry: ctx.getRegistry() });
    }

    const del = /^\/registry\/([^/]+)$/.exec(path);
    if (del && req.method === "DELETE") {
      const id = decodeURIComponent(del[1]);
      const cur = ctx.getRegistry();
      const servers = cur.servers.filter(s => s.id !== id);
      if (servers.length === cur.servers.length) {
        return json({ error: "not found", id }, 404);
      }
      await ctx.setRegistry({ ...cur, servers });
      return json({ ok: true, removed: id });
    }

    return new Response("Not Found\n", { status: 404 });
  };
}
