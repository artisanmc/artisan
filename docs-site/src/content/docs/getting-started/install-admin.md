---
title: Install on a Paper server
description: Install Artisan on your Paper server and open the editor it serves.
---

Artisan is self-hosted: the plugin serves the web editor from your own Minecraft
server. There is no account to create and no external service to link.

> **Prerequisites**
> - Paper 1.21 or newer (Folia and Leaf are supported)
> - Java 21
> - Outbound internet access at first start: Paper downloads the plugin's
>   libraries (Jetty, HikariCP, JDBC drivers) from Maven Central

## 1. Install the plugin

Download the latest `artisan-plugin-*.jar` from the Artisan GitHub Releases page
and drop it into your server's `plugins/` folder. Nothing else is required: the
plugin ships its own copy of PacketEvents.

Restart the server. Artisan creates `plugins/Artisan/config.yml` (settings) and
`plugins/Artisan/environment.yml` (web editor, network and database), and starts
the editor's web server on port **8765**.

To update, replace the jar and restart. Every server of a network must run the
same Artisan release.

## 2. Open the editor

The editor listens on `web.port` (8765 by default) of the server. Open that port
to the admins who use the editor; players never need it unless Artisan pushes the
resource pack itself (see [Resource packs](#4-resource-packs)).

In game, run:

```
/artisan editor
```

It prints a link that signs you in as your player. The link works once and expires
after 60 seconds; you can request one per minute. The session lasts 12 hours and
ends when the server restarts.

What you can do in the editor depends on permissions, read when you request the link:

| Permission | Allows |
|---|---|
| `artisan.editor.view` | Open the editor and read projects |
| `artisan.editor.edit` | Change projects (private drafts) |
| `artisan.editor.publish` | Publish projects to the server |
| `artisan.editor.config` | Change the server configuration from the editor |
| `artisan.editor` | All four (granted to ops by default) |

Give access to your team with a permissions plugin (LuckPerms…). Once the editor
opens, see the [Editor overview](/wiki/editor/) to create your first menu.

The link uses `web.url` when set, otherwise `http://<address you joined with>:8765`.
If the port is taken, or Jetty could not be downloaded, the server starts without
the editor and says so in the console.

## 3. HTTPS (optional)

The editor works over plain HTTP. To serve it on a domain with HTTPS, put it
behind a reverse proxy (Caddy, nginx) or a Cloudflare Tunnel, and tell Artisan
its public address:

```yaml
# environment.yml
web:
  bind: "127.0.0.1"                  # only the local proxy can reach the port
  url: "https://editor.example.com"  # used in /artisan editor links
```

The proxy must forward WebSocket upgrades (`/ws/editor`). Restart the server
after changing `web.*`.

## 4. Resource packs

Custom images, glyphs and fonts reach players through a resource pack. The editor
builds it in your browser after each publish and uploads it to the server. Artisan
then applies it in one of two ways, set by `resource-pack.delegate-to-dir` in
`config.yml`.

**Delegation to a pack host (recommended)** — if you already run Nexo, Oraxen or
ItemsAdder, Artisan writes its pack where that plugin merges external packs and
runs its reload command. Players get a single pack prompt and nothing else needs
to be exposed.

```yaml
# Nexo: a single zip (its directory scanner skips PNGs for non-vanilla namespaces)
resource-pack:
  delegate-to-dir: "plugins/Nexo/pack/external_packs/artisan.zip"
  delegate-reload-command: "n reload"
```

```yaml
# Oraxen / ItemsAdder: a directory, written under <path>/assets/artisan/
resource-pack:
  delegate-to-dir: "plugins/Oraxen/pack/external_packs/artisan"
  delegate-reload-command: "oraxen reload pack"
```

The path is filesystem-absolute or relative to the server root.

**Push by Artisan** — leave `delegate-to-dir` empty. Artisan sends its pack to each
player using the 1.20.3+ pack stack, alongside other packs. Players download it
from the editor's web server (`/resource-pack/<sha1>.zip`), so the editor port must
be reachable by players and `web.url` must be an address they can open.

## 5. Several servers (network)

Behind a proxy, one server serves the editor for all of them: the **hub**. The
others are **leaves**: they connect to the hub, and the editor reaches their
projects through it.

On each leaf, in `environment.yml`:

```yaml
web:
  role: "leaf"
  name: "survival"                          # its name in the editor; empty uses the server folder name
  hub-url: "ws://10.0.0.5:8765/ws/plugin"   # the hub's address on the internal network
```

The hub keeps the default `role: "hub"`. Hub and leaves share a secret, found in
this order:

1. `web.secret`, if set (the same value on every server);
2. the Velocity forwarding secret in `config/paper-global.yml`;
3. otherwise a secret the hub generates in `plugins/Artisan/network-secret`: copy
   it into `web.secret` on each leaf.

Keep `/ws/plugin` on your internal network. All servers must run the same Artisan
release: the editor lists a server on another version as needing an update and
does not edit it. To share the suite plugins' data between servers, use MySQL or
MariaDB (`database.type`); H2 works but keeps one database per server.

A project of a leaf shows in the editor as `<server>.<folder>`. `/artisan editor`
works on any server of the network: a leaf asks the hub for the link.

## 6. Commands

| Command | Description |
|---|---|
| `/artisan menu <id>` | Open a menu by id (in game, players only). |
| `/artisan reload` | Reload settings and menus from disk, including files edited by hand. `web.*` changes need a restart. |
| `/artisan sync status` | Points to the server log. |
| `/artisan sync reject` | Reload menus from disk; on a leaf, reconnect to the hub. |
| `/artisan editor` | Print your sign-in link to the editor (in game, requires `artisan.editor.view`). |

## 7. Troubleshooting

**`/artisan editor` says the editor is disabled**
The web server did not start: `web.enabled` is `false`, the port is taken, or Jetty
could not be downloaded. The startup log says which.

**The link does not open**
The editor port is not reachable from your browser. Open `web.port` in your
firewall, or set `web.url` to the address you use (reverse proxy, tunnel).

**On a leaf, `/artisan editor` says the hub is offline**
The leaf cannot reach `web.hub-url`, or the secrets differ. Check the leaf's
startup log and the hub's address.

**A server shows "Update required"**
It runs a different Artisan release from the hub. Install the same jar everywhere.

**Resource pack not loading**
In push mode, players must reach the editor port at `web.url`. If another plugin
(Oraxen, Nexo, ItemsAdder) also sends a pack, players see two prompts: switch to
delegation.

**Files edited by hand don't show up**
Run `/artisan reload`.

**Menus open empty**
Menu content is sent to players through packets. If the startup log shows
`PacketEvents failed to load` or `failed to start`, your server version is
newer than the bundled PacketEvents: update Artisan.

## 8. Reference: `environment.yml` and `config.yml`

`environment.yml` says where and who this server is: web editor, network and the
database lent to the plugins of the suite. Only the plugin reads it; the editor
never reads nor writes it. Any value may read an environment variable
(`"${NAME}"`). Changes apply after a restart.

```yaml
web:
  enabled: true
  port: 8765     # the only port to open; players need it only in push mode
  bind: ""       # empty: every interface; "127.0.0.1" behind a reverse proxy
  url: ""        # public address used in /artisan editor links; empty: the address the player joined with
  role: "hub"    # "hub", or "leaf" on every other server of a network
  name: ""       # this server's name in the editor; empty: the server folder name
  hub-url: ""    # on a leaf, e.g. "ws://10.0.0.5:8765/ws/plugin"
  secret: ""     # empty: Velocity forwarding secret, else plugins/Artisan/network-secret
database:
  type: "h2"     # h2 (a single file, nothing to set up) | mysql | mariadb
  host: "localhost"
  port: 3306
  name: "minecraft"
  user: "root"
  password: ""   # e.g. "${ARTISAN_DB_PASSWORD}"
```

Each plugin that asks Artisan for the database gets its own connection pool of
`database.pool-size` connections (in `config.yml`). Artisan itself creates no
tables.

`config.yml` holds every other setting. Edit it by hand (then `/artisan reload`)
or from the **Configuration** section of the server page in the editor (requires
`artisan.editor.config`): the plugin checks each value, rewrites the file
(comments kept) and reloads. From the editor, paths must stay under the server
root (no absolute path, no `..`).

```yaml
database:
  pool-size: 4

# Language for plugin system messages (en, fr). Defaults to en.
# Place custom lang files in plugins/Artisan/lang/<code>.yml to override.
language: "en"

# When true, plugin messages are sent in each player's client language when
# a matching lang file is available. Falls back to 'language' if not.
per_player_language: false

resource-pack:
  # Only gates the push to players; keep it true in delegation mode.
  enabled: true
  prompt: "<gold>Pack Artisan</gold>"
  send-on-join: true
  send-delay-ticks: 20
  # Empty: Artisan pushes its pack. Set: Artisan writes it there instead
  # (".zip" suffix: a single zip; otherwise a directory) for the host plugin.
  delegate-to-dir: ""
  # Console command run after each pack update, e.g. "n reload" (Nexo).
  delegate-reload-command: ""
  # Textures drawn back on the other windows when a menu turns its vanilla
  # texture off. "project:image" names a project image in the vanilla layout
  # (256×256 or an HD multiple); empty = the vanilla texture.
  container-textures:
    chest: ""
    hopper: ""
    dispenser: ""
```
