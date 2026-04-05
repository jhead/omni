import { forwardToAnthropicHeaders } from "./forwardHeaders";
import { emitLog, logJsonPayload, LOG_PREFIX, resolveLogging } from "./logging";
import { tapUpstreamResponse } from "./responseTap";
import type { MessagesBody, ProxyConfig } from "./types";
import { transformMessagesBody } from "./transform";

const PATH = "/v1/messages";

function responseHeaders(upstream: Response): Headers {
  const h = new Headers();
  const copy = [
    "content-type",
    "cache-control",
    "anthropic-ratelimit-requests-limit",
    "anthropic-ratelimit-requests-remaining",
    "anthropic-ratelimit-requests-reset",
    "anthropic-ratelimit-tokens-limit",
    "anthropic-ratelimit-tokens-remaining",
    "anthropic-ratelimit-tokens-reset",
    "request-id",
  ] as const;
  for (const name of copy) {
    const v = upstream.headers.get(name);
    if (v) h.set(name, v);
  }
  return h;
}

/**
 * Fetch handler that reads {@link ProxyConfig} on every request via `getConfig()`
 * so updates apply immediately without restarting the process.
 */
export function createOmnirouterFetch(
  getConfig: () => ProxyConfig,
): (req: Request) => Promise<Response> {
  return async function omnirouterFetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (req.method !== "POST" || url.pathname !== PATH) {
      return new Response("Omnirouter: POST /v1/messages only\n", {
        status: 404,
      });
    }

    const cfg = getConfig();
    const log = resolveLogging(cfg.logging);

    if (log.incomingRequest || log.outgoingRequest || log.response) {
      emitLog(`${LOG_PREFIX} ← incoming POST /v1/messages`);
    }

    let raw: MessagesBody;
    try {
      raw = (await req.json()) as MessagesBody;
    } catch (e) {
      emitLog(
        `${LOG_PREFIX} request JSON parse failed: ${e instanceof Error ? e.message : String(e)}`,
      );
      return new Response("Invalid JSON body\n", { status: 400 });
    }

    if (log.incomingRequest) {
      logJsonPayload("incoming", raw, log.maxBodyBytes);
    }

    const body = transformMessagesBody(raw, cfg);
    if (log.outgoingRequest) {
      logJsonPayload("outgoing", body, log.maxBodyBytes);
    }

    const base = cfg.upstreamBaseUrl.replace(/\/$/, "");
    const upstreamUrl = `${base}${PATH}${url.search}`;

    const upstream = await fetch(upstreamUrl, {
      method: "POST",
      headers: forwardToAnthropicHeaders(req),
      body: JSON.stringify(body),
    });

    const outHeaders = responseHeaders(upstream);
    const ct = upstream.headers.get("content-type") ?? "";
    const isSse = ct.includes("text/event-stream");
    const isJson = ct.includes("application/json") && !isSse;

    if (log.response || isSse || isJson) {
      return tapUpstreamResponse(upstream, outHeaders, {
        logMaxBytes: log.response ? log.maxBodyBytes : 0,
      });
    }

    return new Response(upstream.body, {
      status: upstream.status,
      headers: outHeaders,
    });
  };
}
