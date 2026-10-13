---
title: environment.yml
description: Reference of plugins/Artisan/environment.yml — web editor, network role and database.
sidebar:
  order: 1
---

`plugins/Artisan/environment.yml` says **where and who this server is**: the web
editor it serves, its place in a network, and the database. Only the plugin reads
it. The editor never reads nor writes it, so secrets and passwords stay on the server.

Artisan writes the commented template once, on first start, and never rewrites it.
A key you delete falls back to its default.

**Changes apply after a server restart.** (`/artisan reload` re-reads the file, but
the web server and the database pools are only started once.)

## `web`

| Key | Default | Meaning |
|---|---|---|
| `web.enabled` | `true` | Start the editor's web server. `false`: no editor on this server, and `/artisan editor` says the editor is not running. Keep it `true` on leaves too, so `/artisan editor` works there. |
| `web.port` | `8765` | TCP port of the editor, its API, its WebSockets (`/ws/editor`, `/ws/plugin`) and the resource pack downloads (`/resource-pack/`). |
| `web.bind` | `""` | Interface to listen on. Empty: every interface. `"127.0.0.1"` when a reverse proxy on the same machine is the only client. A private address (`"10.0.0.5"`) to stay on an internal network. |
| `web.url` | `""` | Public address of the editor, without trailing slash, e.g. `"https://editor.example.com"`. Used in `/artisan editor` links and in resource-pack URLs sent to players. Empty: `http://<address the player joined with>:<port>` for links, `http://<server-ip in server.properties, else localhost>:<port>` for resource packs. |
| `web.role` | `"hub"` | `"hub"`: this server serves the editor. `"leaf"`: this server connects to the hub of a network and serves nothing itself. Any other value means `hub`. See [Network mode](/wiki/network/concepts/). |
| `web.name` | `""` | This server's name in the network and in project ids (`<name>.<folder>`). Empty: the name of the server's folder. Characters other than letters, digits, `_` and `-` become `-`; 64 characters max; `local` is reserved. |
| `web.hub-url` | `""` | On a leaf only: the hub's plugin WebSocket, e.g. `"ws://10.0.0.5:8765/ws/plugin"` (or `wss://…` through a TLS proxy). Empty on a leaf: the leaf does not connect. |
| `web.secret` | `""` | Secret shared by the hub and its leaves. Empty: the Velocity forwarding secret, else a secret the hub generates. See [the shared secret](/wiki/network/setup/#4-the-shared-secret). |

On a leaf, `web.port`, `web.bind` and `web.url` are ignored: a leaf opens no port.

## `database`

The database Artisan lends to the plugins of its suite (add-ons that ask for it).
Artisan itself creates no tables. See [Database](/wiki/configuration/database/).

| Key | Default | Meaning |
|---|---|---|
| `database.type` | `"h2"` | `h2` (embedded file, nothing to set up), `mysql` (MySQL 8+) or `mariadb` (MariaDB 10.6+). |
| `database.host` | `"localhost"` | MySQL/MariaDB host. Ignored for H2. |
| `database.port` | `3306` | MySQL/MariaDB port. Ignored for H2. |
| `database.name` | `"minecraft"` | Database (schema) name. Ignored for H2. |
| `database.user` | `"root"` | User. Ignored for H2. |
| `database.password` | `""` | Password. Ignored for H2. Prefer an environment variable. |

The pool size is not here but in `config.yml` (`database.pool-size`).

## Environment variables

Any text value may reference an environment variable as `"${NAME}"`, alone or inside
a longer string:

```yaml
web:
  url: "https://${EDITOR_HOST}"
  secret: "${ARTISAN_SECRET}"
database:
  password: "${ARTISAN_DB_PASSWORD}"
```

A variable that is not set becomes an empty string. For `database.*` keys the
console warns: `[database] environment variable NAME is not set (environment.yml)`.

Substitution applies to `web.bind`, `web.url`, `web.name`, `web.hub-url`,
`web.secret` and every `database.*` key. It does not apply to `web.enabled`,
`web.port` and `web.role`: write those literally.

## Default file

```yaml
web:
  enabled: true
  port: 8765
  bind: ""
  url: ""
  role: "hub"
  name: ""
  hub-url: ""
  secret: ""

database:
  type: "h2"
  host: "localhost"
  port: 3306
  name: "minecraft"
  user: "root"
  password: ""
```

Complete files for real setups: [Configuration examples](/wiki/configuration/examples/)
and [Network example configs](/wiki/network/example-configs/).
