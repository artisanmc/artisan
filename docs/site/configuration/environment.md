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

## `name`

| Key | Default | Meaning |
|---|---|---|
| `name` | `""` | This server's name in the editor, in the network and in project ids (`<name>.<folder>`). Empty: the name of the server's folder, with characters other than letters, digits, `_` and `-` turned into `-`. |

Behind Velocity, set `name` to the server's name in `velocity.toml` (its key under
`[servers]`): plugins that store locations use this name to send players to the right
server. Set it before going multi-server — the folder name is often the same everywhere
in containers (`data`, `container`).

A written `name` is never altered: letters, digits, `_` and `-` only, 64 characters max.
Anything else is refused at startup with an error in the console, and the server does not
connect to the hub. The name is a label: the server is identified by the id in
`plugins/Artisan/server-id`, so renaming it keeps its projects and history.

## `web`

| Key | Default | Meaning |
|---|---|---|
| `web.enabled` | `true` | Start the editor's web server. `false`: no editor on this server, and `/artisan editor` says the editor is not running. Keep it `true` on leaves too, so `/artisan editor` works there. |
| `web.port` | `8765` | TCP port of the editor, its API, its WebSockets (`/ws/editor`, `/ws/plugin`) and the resource pack downloads (`/resource-pack/`, by players when Artisan sends the pack itself). |
| `web.bind` | `""` | Interface to listen on. Empty: every interface. `"127.0.0.1"` when a reverse proxy on the same machine is the only client. A private address (`"10.0.0.5"`) to stay on an internal network. |
| `web.url` | `""` | Public address of the editor, without trailing slash, e.g. `"https://editor.example.com"`. Used in `/artisan editor` links. Empty: `http://<address the player joined with>:<port>`. |
| `web.hub` | `""` | Empty: this server serves its own editor; servers on the same MySQL/MariaDB database find each other and join each other's links (see [Networks](../web-server/#networks-and-wsplugin)). Set: this server is a leaf and connects to the hub at this address, as the leaf sees it: `"10.0.0.5:8765"` (the hub's `web.port`; a bare host takes `8765`), `"hub:8765"` (Docker service), or `"https://editor.example.com"` (TLS reverse proxy, no port added). The plugin adds the `/ws/plugin` path; an explicit `ws://…` or `wss://…` URL is kept as is. See [Network mode](../../network/concepts/). |
| `web.secret` | `""` | Secret shared by the hub and its leaves. Empty: the Velocity forwarding secret, else a secret the hub generates. See [the shared secret](../../network/setup/#4-the-shared-secret). |
| `web.tunnel` | `"connect.artisanmc.app"` | Preview. The Artisan tunnel server the hub connects out to when `web.url` is empty: it gives the editor an `https://<id>.artisanmc.app` address, used by `/artisan editor` links. No port to open. `""`: no tunnel. Ignored on a leaf. See [Through a tunnel server](../web-server/#through-a-tunnel-server-preview-the-default). |
| `web.tunnel-access` | `""` | The access code a private tunnel server asks for. |
| `web.pack-cdn` | `"cdn.artisanmc.net"` | Where the hub uploads the resource pack the editor builds; players download it from there when Artisan sends the pack itself. Public, deleted 30 days after its last use. `""`, or the host unreachable: players download it from `web.url` or `web.port`. Ignored on a leaf. See [Resource packs](../resource-packs/#direct-sending). |
| `web.mcp` | `false` | Preview. Serves an MCP endpoint at `<editor address>/mcp`, so a player can connect an AI client (Claude, ChatGPT, an IDE) to Artisan: the client reads the Projects and writes drafts, which the player reviews and deploys in the editor. The client cannot deploy. See [AI clients](../web-server/#ai-clients-mcp-preview). |

On a leaf, `web.port`, `web.bind` and `web.url` are ignored: a leaf opens no port.

## `ai`

Preview. The editor's assistant, on your own model account. Read by the hub only, never sent to
the editor. You can leave it out and set the assistant from the editor instead (**Settings →
Assistant**), once for the whole network. When this section names a `provider`, it wins: the
editor shows its values read-only. See [The editor's assistant](../web-server/#the-editors-assistant-preview).

| Key | Default | Meaning |
|---|---|---|
| `ai.provider` | `""` | `"anthropic"`. Empty: no assistant. |
| `ai.api-key` | `""` | The provider's API key. Write `"${ANTHROPIC_API_KEY}"` to read it from the environment instead of the file. Every message of every player who uses the assistant is billed to it. |
| `ai.model` | `"claude-opus-5-5"` | The model the assistant runs on. |
| `ai.effort` | `"medium"` | `low`, `medium`, `high`, `xhigh` or `max`: how hard the model thinks, and how many tokens it spends. |
| `ai.max-steps` | `25` | Model calls one message may make (1 to 100). The assistant stops there and says so; the next message lets it go on. |
| `ai.base-url` | `""` | Another address for the API: a proxy, or another vendor's compatible API (DeepSeek: `https://api.deepseek.com/anthropic`). Empty: Anthropic's. |

## `database`

The database Artisan lends to the plugins of its suite (add-ons that ask for it).
Artisan itself creates no tables. See [Database](../database/).

| Key | Default | Meaning |
|---|---|---|
| `database.type` | `"h2"` | `h2` (embedded file, nothing to set up), `mysql` (MySQL 8+) or `mariadb` (MariaDB 10.6+). |
| `database.host` | `"localhost"` | MySQL/MariaDB host. Ignored for H2. |
| `database.port` | `3306` | MySQL/MariaDB port. Ignored for H2. |
| `database.name` | `"minecraft"` | Database (schema) name. Ignored for H2. |
| `database.user` | `"root"` | User. Ignored for H2. |
| `database.password` | `""` | Password. Ignored for H2. Prefer an environment variable. |
| `database.pool-size` | `4` | Maximum connections of **each** plugin's own pool (clamped to 1–50). A value left in `config.yml` by an older version is still read until this key is set. |
| `database.table-prefix` | `"artisan_"` | In front of every table of the suite: Artisan's (`artisan_servers`) and each plugin's (`artisan_quests_…`). Change it only to share one database between two separate installations, and set the same value on every server of a network. Lower-case letters, digits and `_`, starting with a letter and ending with `_`, 16 characters at most. Changing it later does not rename the tables: Artisan refuses to open the database while the tables of the previous prefix are there, until you set it back, rename them, or delete `plugins/Artisan/database/table-prefix`. |

## `dev`

Development settings, absent from the default file.

| Key | Default | Meaning |
|---|---|---|
| `dev.editor-bundles.<module>` | none | Path to a module's editor view (`ui.js`) on this machine, absolute or relative to the server root. The server serves that file instead of the one in the module's jar, and re-reads it when it changes: run `vite build --watch` in the module's `editor/` folder and reload the editor to see each build. The module must ship a bundle in its jar (its SDK version is kept). A missing or invalid file falls back to the jar, with a warning in the console. The editor shows a notice while a view comes from a file. Applies after a restart. |

```yaml
dev:
  editor-bundles:
    msquests: "/home/me/MSQuests/bukkit/src/main/resources/artisan-editor/ui.js"
```

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

Substitution applies to `name`, `web.bind`, `web.url`, `web.hub`, `web.secret`, `web.tunnel`, `web.tunnel-access`, `web.pack-cdn`
and every `database.*` key. It does not apply to `web.enabled` and `web.port`:
write those literally.

## Default file

```yaml
name: ""

web:
  enabled: true
  port: 8765
  bind: ""
  url: ""
  hub: ""
  secret: ""

database:
  type: "h2"
  host: "localhost"
  port: 3306
  name: "minecraft"
  user: "root"
  password: ""
```

Complete files for real setups: [Configuration examples](../examples/)
and [Network example configs](../../network/example-configs/).
