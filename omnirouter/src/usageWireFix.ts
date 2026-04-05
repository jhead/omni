/**
 * Ensures `usage` is a plain object where Anthropic-shaped payloads expect it, so clients
 * that read `usage.input_tokens` without guards do not throw on null/omitted usage.
 */

const MAX_USAGE_WALK_DEPTH = 48;

export function sanitizeUsageObjectsDeep(
  value: unknown,
  depth = 0,
  seen: WeakSet<object> = new WeakSet(),
): void {
  if (depth > MAX_USAGE_WALK_DEPTH) return;
  if (value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) {
      if (item !== null && typeof item === "object") {
        sanitizeUsageObjectsDeep(item, depth + 1, seen);
      }
    }
    return;
  }
  const o = value as Record<string, unknown>;
  if (seen.has(o)) return;
  seen.add(o);

  for (const key of Object.keys(o)) {
    const v = o[key];
    if (key === "usage") {
      if (v == null || typeof v !== "object" || Array.isArray(v)) {
        o[key] = {};
      } else {
        sanitizeUsageObjectsDeep(v, depth + 1, seen);
      }
    } else if (v !== null && typeof v === "object") {
      sanitizeUsageObjectsDeep(v, depth + 1, seen);
    }
  }
}

function ensureAnthropicUsageKeysPresent(o: Record<string, unknown>): void {
  const t = o.type;
  if (typeof t !== "string") return;

  if (t === "message_start") {
    const msg = o.message;
    if (msg && typeof msg === "object" && !Array.isArray(msg)) {
      const m = msg as Record<string, unknown>;
      if (m.usage == null || typeof m.usage !== "object" || Array.isArray(m.usage)) {
        m.usage = {};
      }
    }
    return;
  }

  if (t === "message_delta" || t === "message_stop") {
    if (o.usage == null || typeof o.usage !== "object" || Array.isArray(o.usage)) {
      o.usage = {};
    }
    if (t === "message_delta") {
      const delta = o.delta;
      if (delta && typeof delta === "object" && !Array.isArray(delta)) {
        const d = delta as Record<string, unknown>;
        if (d.usage == null || typeof d.usage !== "object" || Array.isArray(d.usage)) {
          d.usage = {};
        }
      }
    }
    return;
  }

  if (t === "message") {
    if (o.usage == null || typeof o.usage !== "object" || Array.isArray(o.usage)) {
      o.usage = {};
    }
  }
}

export function normalizeAnthropicMessagePayload(o: Record<string, unknown>): void {
  sanitizeUsageObjectsDeep(o);
  ensureAnthropicUsageKeysPresent(o);
}
