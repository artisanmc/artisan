---
title: Network example configs
description: Complete configuration of a Velocity network of three servers with MySQL — a hub and two leaves.
sidebar:
  order: 3
---

A complete, realistic network: Velocity in front of three Paper servers on a private
network, one MariaDB shared by the add-ons, and the editor on
`https://editor.example.com` through Caddy on the hub machine.

| Machine | Private address | Runs |
|---|---|---|
| proxy | `10.0.0.2` | Velocity (public port 25565) |
| lobby | `10.0.0.5` | Paper `lobby` — **hub** — and Caddy (public 80/443) |
| survival | `10.0.0.6` | Paper `survival` — leaf |
| skyblock | `10.0.0.7` | Paper `skyblock` — leaf |
| db | `10.0.0.20` | MariaDB |

The secret comes from Velocity's forwarding secret, already in every server's
`config/paper-global.yml`: `web.secret` stays empty.

## lobby (hub)

```yaml
# plugins/Artisan/environment.yml
name: "lobby"

web:
  enabled: true
  port: 8765
  bind: "10.0.0.5"                    # private network only; Caddy proxies to it
  url: "https://editor.example.com"
  hub: ""                             # empty: this server is the hub
  secret: ""                          # Velocity forwarding secret

database:
  type: "mariadb"
  host: "10.0.0.20"
  port: 3306
  name: "artisan"
  user: "artisan"
  password: "${ARTISAN_DB_PASSWORD}"
```

```caddyfile
# /etc/caddy/Caddyfile on lobby
editor.example.com {
	respond /ws/plugin 403            # leaves use the private address
	reverse_proxy 10.0.0.5:8765
}
```

```bash
# firewall on lobby: leaves reach 8765 privately; the public reaches Caddy only
ufw allow 80,443/tcp
ufw allow from 10.0.0.0/24 to any port 8765 proto tcp
ufw allow from 10.0.0.2 to any port 25565 proto tcp
```

## survival (leaf)

```yaml
# plugins/Artisan/environment.yml
name: "survival"

web:
  enabled: true
  port: 8765
  bind: ""
  url: ""
  hub: "10.0.0.5:8765"                # the lobby's private address and web.port
  secret: ""                          # Velocity forwarding secret

database:
  type: "mariadb"
  host: "10.0.0.20"
  port: 3306
  name: "artisan"
  user: "artisan"
  password: "${ARTISAN_DB_PASSWORD}"
```

## skyblock (leaf)

```yaml
# plugins/Artisan/environment.yml
name: "skyblock"

web:
  enabled: true
  port: 8765
  bind: ""
  url: ""
  hub: "10.0.0.5:8765"                # the lobby's private address and web.port
  secret: ""

database:
  type: "mariadb"
  host: "10.0.0.20"
  port: 3306
  name: "artisan"
  user: "artisan"
  password: "${ARTISAN_DB_PASSWORD}"
```

## config.yml

Per server. Each server hands Artisan's pack to its own pack plugin, which sends it
to players: Oraxen on the lobby and skyblock, Nexo on the survival server.

```yaml
# lobby and skyblock — plugins/Artisan/config.yml
database:
  pool-size: 4
language: "en"
per_player_language: true
resource-pack:
  delegate-to-dir: "plugins/Oraxen/pack/external_packs/artisan"
  delegate-reload-command: "oraxen reload pack"
```

```yaml
# survival — plugins/Artisan/config.yml
database:
  pool-size: 4
language: "en"
per_player_language: true
resource-pack:
  delegate-to-dir: "plugins/Nexo/pack/external_packs/artisan.zip"
  delegate-reload-command: "n reload"
```

## Without Velocity

With BungeeCord or no proxy, add the same secret to all three files:

```yaml
web:
  secret: "${ARTISAN_NETWORK_SECRET}"
```

## Result

| In the editor | Lives on |
|---|---|
| `shop` | lobby, `plugins/Artisan/projects/shop/` |
| `survival.shop` | survival, `plugins/Artisan/projects/shop/` |
| `skyblock.island-menu` | skyblock, `plugins/Artisan/projects/island-menu/` |

## Local test network with Docker

The repository ships a two-server network for testing:
`docker compose -f docker/network/compose.yml up` (a hub on ports 25565 and 8765, a
leaf on 25566). Its leaf uses the Docker service name: `hub: "hub:8765"`.
