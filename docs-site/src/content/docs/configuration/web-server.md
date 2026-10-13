---
title: Web server & HTTPS
description: Expose the editor on port 8765, or behind nginx, Caddy or a Cloudflare Tunnel with HTTPS.
sidebar:
  order: 4
---

The Artisan plugin embeds a web server (Jetty). On the server that serves the
editor — a single server, or the hub of a network — it listens on `web.port`
(default **8765**) and answers:

| Path | What | Who uses it |
|---|---|---|
| `/` and static files | The editor | Admins' browsers |
| `/login/<token>` | Sign-in links from `/artisan editor` | Admins' browsers |
| `/api/v1/…` | The editor's API (session cookie required) | The editor |
| `/ws/editor` | Live updates (WebSocket) | The editor |
| `/ws/plugin` | Leaf servers of a network (WebSocket, shared secret) | Other Minecraft servers — hub only |
| `/resource-pack/<sha1>.zip` | The resource pack built by the editor | Players' clients, in push mode only |

Settings live under `web` in [environment.yml](/wiki/configuration/environment/#web)
and apply after a restart.

## Plain HTTP on the port

The default. Nothing to configure: open port 8765 to the people who use the editor,
and `/artisan editor` links point to `http://<address you joined with>:8765`.

Fine on a LAN or for testing. On the internet, prefer HTTPS: the sign-in link and
the session cookie travel in clear text over plain HTTP.

## HTTPS behind a reverse proxy

Run the proxy on the same machine, keep the port private, and tell Artisan its
public address:

```yaml
# plugins/Artisan/environment.yml
web:
  port: 8765
  bind: "127.0.0.1"                  # only the local proxy can reach it
  url: "https://editor.example.com"  # used in /artisan editor links and pack URLs
```

Restart the Minecraft server after the change.

### What the proxy must do

- **Forward WebSocket upgrades** for `/ws/editor` (and `/ws/plugin` if leaves connect
  through the proxy).
- **Keep the original `Host` header.** The editor's writes and its WebSocket are
  refused (`403`, `cross_origin`) when the browser's `Origin` does not match the
  `Host` that reaches Artisan.
- **Accept request bodies up to 100 MB**: the editor uploads the resource pack
  (Artisan's own limit is 100 MB).
- Not time out idle WebSockets too early (Artisan closes them after 5 minutes idle).

### Caddy

Caddy gets a certificate automatically, forwards WebSockets and keeps `Host` by default:

```caddyfile
editor.example.com {
	reverse_proxy 127.0.0.1:8765
}
```

### nginx

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 443 ssl;
    http2 on;
    server_name editor.example.com;

    ssl_certificate     /etc/letsencrypt/live/editor.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/editor.example.com/privkey.pem;

    client_max_body_size 100m;          # resource pack uploads

    location / {
        proxy_pass http://127.0.0.1:8765;
        proxy_http_version 1.1;
        proxy_set_header Host $host;    # required: nginx sends 127.0.0.1:8765 otherwise
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 1h;
    }
}
```

### Cloudflare Tunnel

No open port at all: `cloudflared` connects out to Cloudflare and forwards to the
local port. WebSockets work by default and the `Host` header is kept.

```yaml
# /etc/cloudflared/config.yml
tunnel: 6ff42ae2-765d-4adf-8112-31c55c1551ef
credentials-file: /etc/cloudflared/6ff42ae2-765d-4adf-8112-31c55c1551ef.json

ingress:
  - hostname: editor.example.com
    service: http://127.0.0.1:8765
  - service: http_status:404
```

Then `cloudflared tunnel route dns <tunnel> editor.example.com` and set
`web.url: "https://editor.example.com"`. Cloudflare limits request bodies to 100 MB on
the Free and Pro plans, which matches Artisan's resource pack limit.

## Networks and `/ws/plugin`

In a [network](/wiki/network/concepts/), leaves connect to the hub's `/ws/plugin`.
Two ways to arrange this with a proxy:

| Setup | Hub `web.bind` | Leaves' `web.hub` |
|---|---|---|
| Leaves on the same machine as the hub | `"127.0.0.1"` | `"127.0.0.1:8765"` |
| Leaves on other machines of a private network (recommended) | the hub's private address, e.g. `"10.0.0.5"`; point the proxy at it too | `"10.0.0.5:8765"` |
| Leaves elsewhere on the internet | `"127.0.0.1"` | `"https://editor.example.com"`, through the proxy (`wss://…/ws/plugin`) |

`/ws/plugin` is protected by the shared secret, but keep it on your internal network
when you can. When leaves connect directly, you can refuse it at the proxy:

```nginx
location = /ws/plugin { return 403; }
```

```caddyfile
editor.example.com {
	respond /ws/plugin 403
	reverse_proxy 127.0.0.1:8765
}
```

## Resource packs and `web.url`

In push mode, players' clients download the pack from
`<web.url>/resource-pack/<sha1>.zip`. Then `web.url` must be an address **players**
can open, and the proxy must not restrict `/resource-pack/` to admins. Without
`web.url`, pack URLs use `server-ip` from `server.properties`, or `localhost` — which
players cannot reach. See [Resource packs](/wiki/configuration/resource-packs/).
