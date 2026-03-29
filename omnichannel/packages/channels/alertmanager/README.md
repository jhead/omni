# `@omnibot/channel-alertmanager`

Ingress-only channel that receives [Alertmanager](https://prometheus.io/docs/alerting/latest/alertmanager/) webhook notifications and turns them into Omnichannel events for the MCP host (e.g. Claude Code). Outbound `omni_dispatch` is not supported for this plugin; use `noop` or other channels for responses.

## Omnichannel configuration

In `omni.yaml`, add a channel with `plugin: channel-alertmanager`:

```yaml
gateway:
  httpPort: 8080
  # httpHostname: "0.0.0.0"   # listen on all interfaces (default is localhost only)

channels:
  prod_alerts:
    plugin: channel-alertmanager
    # Optional: require Authorization: Bearer <token> on each webhook POST
    # bearerToken: "your-shared-secret"
```

Ensure the gateway process loads this package (same as other channels: list the plugin id under `channels` and run `bun run gateway` from the repo with workspace dependencies installed).

### HTTP endpoint

- **URL:** `http://<gateway-host>:<port>/alertmanager/<channelId>`
- **Method:** `POST`
- **Body:** JSON (Alertmanager webhook payload, schema version 4)
- **Auth:** If `bearerToken` is set on the channel, every request must include:

  `Authorization: Bearer <same value as bearerToken>`

The gateway normalizes the payload (bounded summary + structured fields) before enqueueing; see `@omnibot/channel-alertmanager` exports `normalizeAlertmanagerWebhook` and related types.

## Prometheus and Alertmanager

Flow: **Prometheus** evaluates alerting rules → sends alerts to **Alertmanager** → Alertmanager routes notifications to **receivers**, including a **webhook** that POSTs to this channel.

- Prometheus alerting: [Alerting overview](https://prometheus.io/docs/practices/alerting/)
- Alertmanager configuration: [Configuration](https://prometheus.io/docs/alerting/latest/configuration/)

### Example Alertmanager `alertmanager.yml`

Point `webhook_configs.url` at your gateway. Replace host, port, and channel id (`prod_alerts` must match `omni.yaml`).

```yaml
receivers:
  - name: omnichannel
    webhook_configs:
      - url: 'http://omni-gateway.internal:8080/alertmanager/prod_alerts'
        send_resolved: true
        # If omni.yaml sets bearerToken:
        # http_config:
        #   bearer_token: 'your-shared-secret'

route:
  receiver: omnichannel
  group_by: ['alertname']
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 4h
```

Use `http_config.basic_auth`, `bearer_token`, or TLS settings as required by your environment; see [Alertmanager `http_config`](https://prometheus.io/docs/alerting/latest/configuration/#http_config).

## Operations

- **Bind address:** `gateway.httpHostname` and `gateway.httpPort` control where the HTTP server listens. Default hostname is loopback; use `0.0.0.0` only behind a firewall or reverse proxy.
- **TLS:** Terminate TLS at a reverse proxy (nginx, Caddy, cloud load balancer) and forward HTTP to the gateway, or run the gateway on a trusted network.
- **Reachability:** Alertmanager must be able to reach the gateway URL; DNS and firewall rules must allow outbound HTTP(S) from Alertmanager to the gateway host.
