# Omni app (`apps/omni`)

Single process that runs the **omnichannel gateway** (webhooks, IPC hub, SQLite queue) together with an **agent control plane**: spawn Claude Code (or other) PTYs via omnimux, optional **agent-bus** pub/sub across MCP sessions, and a **browser dashboard** with live terminals (xterm.js).

## Startup order

1. Ensure **`ANTHROPIC_API_KEY`** is in the environment (omnirouter forwards requests to `omnirouter.upstreamBaseUrl`, default `https://api.anthropic.com`).
2. **Omnirouter** starts inside this process by default (`omnirouter.enabled: true`). It listens on `omnirouter.listen` and proxies to `upstreamBaseUrl`. **Pass-through** mode (`omnirouter.passthrough`, default `true`) forwards client model and tools unchanged; set `passthrough: false` and supply `model` + `toolAllowlist` for filtered mode (see `omnirouter` package).
3. Agent PTYs get `ANTHROPIC_BASE_URL` set to the in-process router (`http://<listen.host>:<listen.port>`) when enabled, or to **`agents.omnirouterUrl`** when `omnirouter.enabled: false` (external router).
4. Optional: **`OMNI_UPSTREAM_BASE_URL`** overrides the default upstream API URL when `omnirouter.upstreamBaseUrl` is omitted in YAML.
5. From the **repository root** (`omni/`, where `package.json` defines workspaces), install dependencies:

```bash
bun install
```

6. Start the app from `apps/omni`:

```bash
cd apps/omni
bun run start
```

Optional: `OMNI_APP_CONFIG` — path to the YAML config file (default: `omni.config.yaml` in the current working directory).

Optional: `OMNI_DEBUG=1` — verbose gateway logging (same idea as `omnibot-gateway --debug`).

## Ports

| Port (default) | Role |
|----------------|------|
| `omnirouter.listen.port` (3456) | Anthropic HTTP proxy (`POST /v1/messages`) when `omnirouter.enabled` |
| `gateway.httpPort` (8080) | Gateway HTTP: `/webhooks/...`, plugin ingress |
| `omniServer.port` (9090) | Control plane: `/api/*` (Bearer), `/`, `/terminal`, WebSocket `/ws/agents/:id` |

IPC Unix socket: `gateway.ipcSocketPath` (resolved relative to the config file directory).

## Control plane API

All `/api/*` routes require:

`Authorization: Bearer <omniServer.bearerToken>`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | `{ ok: true }` (no auth) |
| GET | `/api/agents` | List agents |
| POST | `/api/agents` | Spawn agent (JSON body optional: `id`, `cmd`, `cwd`, `env`, `cols`, `rows`) |
| GET | `/api/agents/:id` | Agent info |
| DELETE | `/api/agents/:id` | Kill agent PTY |
| POST | `/api/agents/:id/input` | Raw text to PTY stdin |
| POST | `/api/agents/:id/resize` | JSON `{ cols, rows }` |

WebSocket `/ws/agents/:id` (no auth in this MVP): raw terminal I/O; JSON message `{ "type": "resize", "cols": N, "rows": M }` resizes the PTY.

## Browser UI

- Dashboard: `http://127.0.0.1:9090/` — store the Bearer token in localStorage, list agents, spawn.
- Terminal: `http://127.0.0.1:9090/terminal?id=<agentId>`

## Agent config directories

Each agent gets a directory under `agents.baseDir/<agentId>/` with:

- `.mcp.json` — `omni` MCP uses **Streamable HTTP** to the gateway (`type: http`, `url` from `gateway.httpHostname`, `httpPort`, and `mcpHttpPath`, default path `/mcp`).
- `.claude/settings.local.json` — enables the `omni` MCP server.

`CLAUDE_CONFIG_DIR`, `HOME`, and `ANTHROPIC_BASE_URL` are set for the PTY so Claude uses that tree and sends API traffic through omnirouter (in-process or external).

## Discord or other channels

Add a channel block to `omni.config.yaml` using the same plugin ids as standalone omnichannel (for example `channel-discord`) and provide the usual env / tokens expected by that plugin. The gateway behavior is unchanged; only the YAML and dependencies matter.

## Cross-agent bus

When `channels` includes `plugin: channel-agent-bus`, the app injects an in-memory `AgentBus` into the gateway config document. MCP clients use `omni_dispatch` on that channel with capabilities `publish`, `subscribe`, and `list_topics` (see `channel-agent-bus` package).
