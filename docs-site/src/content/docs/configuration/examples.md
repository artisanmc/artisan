---
title: Configuration examples
description: Complete configurations for common single-server setups.
sidebar:
  order: 7
---

Full files for common setups. Keys you do not write keep their default. For several
servers, see [Network example configs](/wiki/network/example-configs/).

## Single server, local or LAN

Nothing to change: the defaults serve the editor on `http://<server address>:8765`.
Open port 8765 to the admins only. If you use custom images or titles, delegate the
pack to a pack plugin (below) or set `web.url` so players can download it.

## Single server behind Caddy, pack pushed by Artisan

A VPS running Paper with Caddy in front. Admins open `https://editor.example.com`;
players download the resource pack from the same address. Port 8765 stays closed.

```yaml
# plugins/Artisan/environment.yml
name: ""

web:
  enabled: true
  port: 8765
  bind: "127.0.0.1"
  url: "https://editor.example.com"
  hub: ""
  secret: ""

database:
  type: "h2"
```

```yaml
# plugins/Artisan/config.yml
database:
  pool-size: 4

language: "en"
per_player_language: true

resource-pack:
  enabled: true
  prompt: "<gold>Example Network</gold> <gray>menus and icons</gray>"
  send-on-join: true
  send-delay-ticks: 20
  delegate-to-dir: ""
  delegate-reload-command: ""
  container-textures:
    chest: ""
    hopper: ""
    dispenser: ""
```

```caddyfile
# /etc/caddy/Caddyfile
editor.example.com {
	reverse_proxy 127.0.0.1:8765
}
```

DNS: an `A` record for `editor.example.com` to the VPS. Firewall: open 25565 (Minecraft),
80 and 443 (Caddy); keep 8765 closed.

## Single server with Nexo, behind Cloudflare Tunnel

Nexo already sends a pack: Artisan merges into it, so players see one prompt and only
admins use the editor address.

```yaml
# plugins/Artisan/environment.yml
web:
  bind: "127.0.0.1"
  url: "https://editor.example.com"
```

```yaml
# plugins/Artisan/config.yml
resource-pack:
  enabled: true
  delegate-to-dir: "plugins/Nexo/pack/external_packs/artisan.zip"
  delegate-reload-command: "n reload"
```

```yaml
# /etc/cloudflared/config.yml
tunnel: 6ff42ae2-765d-4adf-8112-31c55c1551ef
credentials-file: /etc/cloudflared/6ff42ae2-765d-4adf-8112-31c55c1551ef.json
ingress:
  - hostname: editor.example.com
    service: http://127.0.0.1:8765
  - service: http_status:404
```

You can put Cloudflare Access in front of `editor.example.com` to restrict it to your
team: in delegation mode players never use that address.

## Secrets in environment variables

With Docker or systemd, keep passwords out of the file:

```yaml
# plugins/Artisan/environment.yml
web:
  url: "${ARTISAN_URL}"
database:
  type: "mysql"
  host: "${DB_HOST}"
  name: "artisan"
  user: "artisan"
  password: "${DB_PASSWORD}"
```

```yaml
# docker-compose.yml (excerpt)
services:
  paper:
    image: itzg/minecraft-server
    environment:
      ARTISAN_URL: "https://editor.example.com"
      DB_HOST: "db"
      DB_PASSWORD: "change-me"
```
