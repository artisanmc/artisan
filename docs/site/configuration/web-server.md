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
| `/resource-pack/<sha1>.zip` | The resource pack built by the editor | The servers, to hand it to their pack plugin |

Settings live under `web` in [environment.yml](../environment/#web)
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

## Through a tunnel server (preview, the default)

For hosts that give no port to open. Unless `web.url` is set, the hub connects **out**
to the Artisan tunnel server (`connect.artisanmc.app`), which gives the editor an
`https://<id>.artisanmc.app` address and passes each request to the plugin unchanged.
Nothing to configure:

```yaml
# plugins/Artisan/environment.yml (the default)
web:
  tunnel: "connect.artisanmc.app"
  tunnel-access: ""          # the code, if the tunnel server is private
```

After a restart, the console shows `Editor reachable through the tunnel server at
https://<id>.artisanmc.app`, and `/artisan editor` links use that address.
`<id>` comes from `plugins/Artisan/tunnel-secret`: it stays the same across restarts.

**A name for the address.** In the editor, **Settings → Editor address** (with
`artisan.editor.config`) gives it a name: `https://survie.artisanmc.app` then answers like
the `<id>` address, which keeps working. One name per server, or per network on a shared
database; first come, first served. A name is freed after 90 days without the server
connecting. Names of the tunnel server, of brands people sign in to and of phishing words
(`login`, `verify`…) are refused. Taking a name gives you a link that signs you in on the new
address; `/artisan editor` links use it from then on.

What to know:

- The tunnel server sees the traffic in clear text (it holds the TLS certificate),
  including the session cookie. `tunnel: ""` turns it off: browsers then reach
  `web.port` directly, or `web.url`.
- The editor itself still comes from your plugin: the tunnel server only passes bytes.
- Players never download the resource pack from the editor's web server: a
  [pack plugin](../resource-packs/) (Nexo, Oraxen, ItemsAdder) sends it.
- `web.url`, when set, replaces the tunnel: no tunnel is opened.
- Only the hub of a network opens a tunnel. A leaf with no port to its hub sets
  `web.hub` to the hub's tunnel address, `https://<id>.artisanmc.app`: it reaches
  `/ws/plugin` and downloads its pack through the tunnel too. On the same machine or
  private network, the internal address (`web.hub: "hub"`) is faster.

## AI clients (MCP, preview)

With `web.mcp: true` in `environment.yml`, the editor's address also answers the
[Model Context Protocol](https://modelcontextprotocol.io) at `/mcp`. A player adds
`https://<editor address>/mcp` as a custom connector in Claude, ChatGPT or another MCP client
(Settings → AI apps in the editor shows the address to copy).

- **Sign-in**: the client opens the editor's consent page. The player signs in as usual
  (`/artisan editor`), sees which client asks, and allows or denies it. The client then acts
  as that player, with their editor permissions less `artisan.editor.publish` and
  `artisan.editor.config`. It needs `artisan.editor.edit`.
- **What it can do**: list the servers, Projects and Documents; read files; read the JSON
  schema of a Document kind; start a draft and write files into it. Each file is checked by the
  Project's server (path, YAML, schema, engine) before it enters the draft.
- **What it cannot do**: deploy. The draft shows up in the player's Drafts in the editor; the
  player reviews the changes and clicks Deploy.
- **Revoking**: Settings → AI apps lists the connected clients; Disconnect cuts one off at its
  next call. Losing `artisan.editor.edit` in game cuts every client of that player; losing
  `artisan.editor.view` removes them.

The endpoint needs an HTTPS address the AI provider can reach: the tunnel server's (the
default), or `web.url` behind a reverse proxy. A reverse proxy must pass `/mcp`, `/oauth/` and
`/.well-known/` to the editor, with `X-Forwarded-Proto` and `Host`.

## Networks and `/ws/plugin`

**Servers that share a MySQL or MariaDB database find each other**, with nothing to set:
they share one tunnel address, and each joins the others' `/ws/plugin` with a secret kept
in the database, trying their internal address first, then the tunnel or `web.url`. From
that address you see and publish on every server; it keeps working while any of them runs. Nothing listens publicly. Two admins on two different links do not see each
other live: a publish that would overwrite the other's is refused instead.

A fixed hub remains possible. In a [network](../../network/concepts/) with `web.hub` set,
leaves connect to the hub's `/ws/plugin` and serve no editor of their own.
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

## Resource packs

Players never download from the editor's web server: the servers fetch the pack
there and hand it to Nexo, Oraxen or ItemsAdder, which send it. See
[Resource packs](../resource-packs/).
