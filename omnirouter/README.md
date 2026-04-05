# @omnibot/omnirouter

HTTP proxy for the Anthropic Messages API (`POST /v1/messages`). By default (**`passthrough`: true**) it forwards client `model` and `tools` unchanged to a configurable upstream base URL (typically `https://api.anthropic.com`). With **`passthrough`: false**, it pins a **model**, **tool allowlist**, and optional **adaptive-thinking stripping** for listed model ids. SSE and JSON responses are optionally normalized so `usage` fields are object-shaped for picky clients.

Requires **[Bun](https://bun.sh)** (uses `Bun.serve`, `Bun.file`).

## Install

In a Bun workspace, add a dependency on this package and import from `@omnibot/omnirouter`.

## CLI

Loads `proxy.config.json` next to the package unless overridden (see below).

```bash
cd omnirouter
bun install
bun run start
# or: bun run src/index.ts
```

With logging flags enabled in config, the process logs the resolved config file path on startup.

## Environment

| Variable | Purpose |
|----------|---------|
| `OMNIROUTER_CONFIG` | Path to JSON config. Default: `proxy.config.json` beside the package. |
| `ANTHROPIC_API_KEY` | If the client request has no `x-api-key` and no `Authorization: Bearer …`, the proxy sets `x-api-key` from this env var. |

## Config file (`proxy.config.json`)

Top-level shape matches `ProxyConfig`:

| Field | Description |
|-------|-------------|
| `listen` | `{ "hostname": string, "port": number }` |
| `upstreamBaseUrl` | HTTPS (or HTTP) base for the Anthropic API, e.g. `https://api.anthropic.com` |
| `passthrough` | Optional, default **`true`**: forward client `model` and `tools` unchanged. When **`false`**, `model` and `toolAllowlist` are required and the legacy filtered behavior applies. |
| `model` | Required when `passthrough` is `false`: model id applied to every proxied request |
| `toolAllowlist` | Required when `passthrough` is `false`: allowed tool **names**; others are stripped |
| `logging` | Optional: `incomingRequest`, `outgoingRequest`, `response`, `maxBodyBytes` |
| `stripAdaptiveThinkingForModels` | Optional: for matching model ids, strip adaptive `thinking` and `output_config.effort` |

`loadConfigFromFile()` and `loadConfig()` validate the file with `validateProxyConfig()` before returning.

## Programmatic API

Use the in-memory server when you control config in TypeScript (no file required). Config is read **per request**, so `setConfig` / `patchConfig` take effect immediately. If `listen.hostname` or `listen.port` change while the server is running, the listener is rebound (same process).

```ts
import {
  createOmnirouter,
  type ProxyConfig,
} from "@omnibot/omnirouter";

const config: ProxyConfig = {
  listen: { hostname: "127.0.0.1", port: 3456 },
  upstreamBaseUrl: "https://api.anthropic.com",
  passthrough: false,
  model: "claude-haiku-4-5-20251001",
  toolAllowlist: ["Read", "Write", "Bash"],
};

const router = createOmnirouter({
  config,
  autoStart: true, // default; use false to call start() yourself
});

// Later:
router.patchConfig({ model: "claude-sonnet-4-6" });
router.getConfig();
router.stop();
router.start();
```
