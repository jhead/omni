import type { ProxyConfig } from "./types";

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim() !== "";
}

/** Throws if `config` is not a usable {@link ProxyConfig}. */
export function validateProxyConfig(config: ProxyConfig): void {
  if (!config.listen || typeof config.listen !== "object") {
    throw new TypeError("config.listen is required");
  }
  if (!isNonEmptyString(config.listen.hostname)) {
    throw new TypeError("config.listen.hostname must be a non-empty string");
  }
  const port = config.listen.port;
  if (
    typeof port !== "number" ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65_535
  ) {
    throw new TypeError("config.listen.port must be an integer from 1 to 65535");
  }

  if (!isNonEmptyString(config.upstreamBaseUrl)) {
    throw new TypeError("config.upstreamBaseUrl must be a non-empty string");
  }
  let u: URL;
  try {
    u = new URL(config.upstreamBaseUrl);
  } catch {
    throw new TypeError(`config.upstreamBaseUrl is not a valid URL: ${config.upstreamBaseUrl}`);
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new TypeError("config.upstreamBaseUrl must be http(s)");
  }

  const passthrough = config.passthrough !== false;

  if (!passthrough) {
    if (!isNonEmptyString(config.model)) {
      throw new TypeError("config.model must be a non-empty string when passthrough is false");
    }

    if (!Array.isArray(config.toolAllowlist)) {
      throw new TypeError("config.toolAllowlist must be an array when passthrough is false");
    }
    for (const name of config.toolAllowlist) {
      if (typeof name !== "string" || name.trim() === "") {
        throw new TypeError("config.toolAllowlist must contain only non-empty strings");
      }
    }
  } else {
    if (config.model !== undefined && !isNonEmptyString(config.model)) {
      throw new TypeError("config.model must be a non-empty string when set");
    }
    if (config.toolAllowlist !== undefined) {
      if (!Array.isArray(config.toolAllowlist)) {
        throw new TypeError("config.toolAllowlist must be an array when set");
      }
      for (const name of config.toolAllowlist) {
        if (typeof name !== "string" || name.trim() === "") {
          throw new TypeError("config.toolAllowlist must contain only non-empty strings");
        }
      }
    }
  }

  if (config.logging !== undefined) {
    const l = config.logging;
    if (typeof l !== "object" || l === null || Array.isArray(l)) {
      throw new TypeError("config.logging must be an object when set");
    }
    if (
      l.maxBodyBytes !== undefined &&
      (typeof l.maxBodyBytes !== "number" || l.maxBodyBytes <= 0)
    ) {
      throw new TypeError("config.logging.maxBodyBytes must be a positive number when set");
    }
  }

  if (config.stripAdaptiveThinkingForModels !== undefined) {
    const a = config.stripAdaptiveThinkingForModels;
    if (!Array.isArray(a)) {
      throw new TypeError("config.stripAdaptiveThinkingForModels must be an array when set");
    }
    for (const id of a) {
      if (typeof id !== "string" || id.trim() === "") {
        throw new TypeError(
          "config.stripAdaptiveThinkingForModels must contain only non-empty strings",
        );
      }
    }
  }
}
