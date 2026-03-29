/**
 * Minimal gateway HTTP surface: bind address + port + fetch. No channel semantics.
 */

export interface GatewayHttpServeOptions {
  /** e.g. `127.0.0.1` (localhost only) or `0.0.0.0` (all interfaces). */
  hostname: string
  port: number
  fetch: (req: Request) => Response | Promise<Response>
}

export function serveGatewayHttp(
  options: GatewayHttpServeOptions,
): ReturnType<typeof Bun.serve> {
  return Bun.serve({
    hostname: options.hostname,
    port: options.port,
    fetch: options.fetch,
  })
}
