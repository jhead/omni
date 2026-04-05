import { emitLog, LOG_PREFIX } from "./logging";
import { normalizeAnthropicMessagePayload } from "./usageWireFix";

const MAX_JSON_BODY_BYTES = 64 * 1024 * 1024;

const enc = new TextEncoder();

function rewriteSseDataLine(line: string): string {
  if (!line.startsWith("data:")) return line;
  const raw = line.slice(5).trimStart();
  if (raw === "[DONE]") return line;
  try {
    const j = JSON.parse(raw) as unknown;
    if (!j || typeof j !== "object" || Array.isArray(j)) return line;
    const o = j as Record<string, unknown>;
    normalizeAnthropicMessagePayload(o);
    return `data: ${JSON.stringify(o)}`;
  } catch (e) {
    emitLog(
      `${LOG_PREFIX} SSE data line JSON parse failed: ${e instanceof Error ? e.message : String(e)}`,
    );
    return line;
  }
}

export type TapOptions = {
  logMaxBytes: number;
};

/**
 * Pass response bytes to the client; optionally rewrite SSE/JSON bodies for stable `usage`
 * shapes, and capture a prefix for logs when `logMaxBytes` > 0.
 */
export function tapUpstreamResponse(
  upstream: Response,
  outHeaders: Headers,
  opts: TapOptions,
): Response {
  const body = upstream.body;
  const ct = upstream.headers.get("content-type") ?? "";
  const status = upstream.status;
  const logCap = opts.logMaxBytes > 0 ? opts.logMaxBytes : 0;
  const isSse = ct.includes("text/event-stream");
  const isJson = ct.includes("application/json") && !isSse;

  if (!body) {
    if (logCap > 0) {
      emitLog(`${LOG_PREFIX} resp ${status} ${ct} (no body)`);
    }
    return new Response(null, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: outHeaders,
    });
  }

  let logCaptured = 0;
  const logChunks: Uint8Array[] = [];
  let logTruncated = false;
  let jsonAccum: Uint8Array[] = [];
  let jsonSize = 0;
  /** Response larger than cap: passthrough raw (cannot safely buffer for rewrite). */
  let jsonSpilled = false;
  const dec = new TextDecoder();
  let sseLineBuf = "";

  const takeLogBytes = (b: Uint8Array) => {
    if (logCap <= 0) return;
    if (logCaptured < logCap) {
      const room = logCap - logCaptured;
      const take = Math.min(b.byteLength, room);
      logChunks.push(take === b.byteLength ? b : b.subarray(0, take));
      logCaptured += take;
      if (take < b.byteLength) logTruncated = true;
    } else {
      logTruncated = true;
    }
  };

  const stream = body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(part, ctrl) {
        if (isSse) {
          sseLineBuf += dec.decode(part, { stream: true });
          let nl: number;
          while ((nl = sseLineBuf.indexOf("\n")) !== -1) {
            const line = sseLineBuf.slice(0, nl).replace(/\r$/, "");
            sseLineBuf = sseLineBuf.slice(nl + 1);
            const rewritten = rewriteSseDataLine(line);
            const lineOut = `${rewritten}\n`;
            const bytes = enc.encode(lineOut);
            ctrl.enqueue(bytes);
            takeLogBytes(bytes);
          }
          return;
        }

        if (isJson) {
          if (jsonSpilled) {
            ctrl.enqueue(part);
            takeLogBytes(part);
            return;
          }
          if (jsonSize + part.byteLength <= MAX_JSON_BODY_BYTES) {
            jsonAccum.push(part);
            jsonSize += part.byteLength;
          } else {
            for (const c of jsonAccum) {
              ctrl.enqueue(c);
              takeLogBytes(c);
            }
            jsonAccum = [];
            jsonSize = 0;
            ctrl.enqueue(part);
            takeLogBytes(part);
            jsonSpilled = true;
            emitLog(
              `${LOG_PREFIX} JSON response exceeds ${MAX_JSON_BODY_BYTES} bytes; passthrough without usage normalization`,
            );
          }
          return;
        }

        ctrl.enqueue(part);
        takeLogBytes(part);
      },
      flush(ctrl) {
        if (isSse) {
          sseLineBuf += dec.decode();
          if (sseLineBuf.length > 0) {
            const line = sseLineBuf.replace(/\r$/, "");
            const rewritten = rewriteSseDataLine(line);
            const bytes = enc.encode(rewritten);
            ctrl.enqueue(bytes);
            takeLogBytes(bytes);
            sseLineBuf = "";
          }
        }

        if (isJson && !jsonSpilled && jsonAccum.length > 0) {
          const len = jsonAccum.reduce((n, c) => n + c.byteLength, 0);
          const merged = new Uint8Array(len);
          let off = 0;
          for (const c of jsonAccum) {
            merged.set(c, off);
            off += c.byteLength;
          }
          try {
            const text = new TextDecoder("utf-8", { fatal: false }).decode(merged);
            const parsed: unknown = JSON.parse(text);
            if (
              parsed !== null &&
              typeof parsed === "object" &&
              !Array.isArray(parsed)
            ) {
              normalizeAnthropicMessagePayload(parsed as Record<string, unknown>);
            }
            const out = JSON.stringify(parsed);
            const outBytes = enc.encode(out);
            ctrl.enqueue(outBytes);
            takeLogBytes(outBytes);
          } catch (e) {
            emitLog(
              `${LOG_PREFIX} JSON response normalize failed, passthrough raw: ${e instanceof Error ? e.message : String(e)}`,
            );
            ctrl.enqueue(merged);
            takeLogBytes(merged);
          }
        }

        if (logCap > 0) {
          const len = logChunks.reduce((n, c) => n + c.byteLength, 0);
          const merged = new Uint8Array(len);
          let o = 0;
          for (const c of logChunks) {
            merged.set(c, o);
            o += c.byteLength;
          }
          let text = new TextDecoder("utf-8", { fatal: false }).decode(merged);
          if (logTruncated) text += "\n...[truncated]";
          emitLog(`${LOG_PREFIX} resp ${status} ${ct}\n${text}`);
        }
      },
    }),
  );

  return new Response(stream, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: outHeaders,
  });
}
