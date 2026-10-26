# The self-hosted editor web server

**Status:** accepted (2026-10-12). Phase B of the self-hosting plan.

## Context

Without a backend, the plugin itself serves the editor, its API and its WebSockets. The plan
called for Javalin. Javalin 7 is written in Kotlin and pulls `kotlin-stdlib` 2.2; loaded
through `libraries:`, it would coexist with the Kotlin 2.0 embedded in the jar, and any
call that passes a `kotlin.*` type from one side to the other breaks at load
(the `LinkageError` family already encountered, see `paper/build.gradle.kts`).

## Decisions

**① Jetty 12, no extra layer.** Pure Java, five dependencies (`jetty-server`,
`jetty-websocket-jetty-server` and their transitives, slf4j already provided by Paper).
Routing fits in `hub/Http.kt`: a table of `method + /segments/:param` routes.

**② Downloaded by Paper.** Declared in `libraries:` of `plugin.yml`, like HikariCP.
A server without outbound access starts without the editor (the `LinkageError` is caught).

**③ `hub` module, no Bukkit.** It only sees the game through `core`'s ports.
`paper` builds it in `ArtisanPlugin` and stops it in `onDisable`.

**④ Configuration in `environment.yml`** (`web.enabled|port|bind|url`), never
written by the editor: a mistake from the configuration page must not
cut off access to the editor itself.

**⑤ Login by in-game link.** `/artisan editor` gives a single-use token
(60 s, one per player per minute); `/login/<token>` opens a session (cookie
`HttpOnly`, `SameSite=Strict`, 12 h). Identity is the player's UUID, rights
are their `artisan.editor.*` permissions at the time of the request. *Revised
2026-10-15*: the console also gets a link, under a single **Console** identity
(nil UUID) shared by whoever uses it — same drafts, same author. Every API route
requires a session; a request that modifies something or opens a
WebSocket must come from the same origin as the page.

**⑥ Same routes as the backend, until the editor is rewritten.** The hub serves the
subset of REST routes that the editor calls (`AccountRoutes`, `ServerRoutes`,
`ProjectRoutes`), with a single network and server named `local` and a Project's
identity equal to its folder name. Each route translates its request into a
protocol message (`project_read`, `project_write`, `project_draft_request`…) passed by
`ServerLink` to the existing handlers: no Project logic is duplicated.
Private drafts stay on the server's disk, one set per player UUID.
No equivalent for now: Versions (empty).
*Revised 2026-10-13 by [server-identity-and-versions](server-identity-and-versions.md):
Versions and drafts in the follow-up database.*

**⑦ Vanilla items and textures without a backend.** The item catalog (`tools/minecraft-assets/items`)
travels in the jar; the 3D icons (`tools/minecraft-assets/icons`) too with `-PwithEditor`. Textures
are extracted from the Mojang client jar, downloaded and verified (SHA-1) at the first
requested texture, into `plugins/Artisan/cache/minecraft/<version>/`. Custom items
are read directly in `CustomItemsManager` (`ItemRoutes`, `VanillaAssets`).
*Rejected:* downloading the icons from GitHub releases (private repository).

**⑧ The pack, served by the server.** The editor sends the zip it builds; the hub
keeps it under its SHA-1 (`PackStore`, last three), serves it publicly under
`/resource-pack/<sha1>.zip` and hands it to the `ResourcePackManager` with that URL. Delegation
and direct sending stay as they are: only the zip's emitter changes.
*Rejected:* removing direct sending (planned); it costs nothing and serves servers without a pack host.

**⑨ The network, connected to the hub through `/ws/plugin`.** The other servers keep their
backend client (`WsClient`, `SyncedMenuProvider`) and point it at the hub. Their `hello` carries the
shared secret as `server_key` and their name as `proxy_name`; the hub keeps what it announces
(`RemoteServer`) and relays each editor request by `request_id`. A disconnected server
stays listed offline (503 `server_offline`). A Project outside the hub's server is identified
as `<server>.<folder>` (`Servers.project`): two servers can have the same folder.
Since 2026-10-14 (issue #43, ADR `server-identity-and-versions`), it is `<server id>.<folder>`
on every server, the hub's included.
*Rejected:* an opaque identifier per Project (a database would be needed to find it back).

**⑩ `hub` and `leaf` roles.** `web.role: leaf` turns off the web server and points the client at
`web.hub-url` with the network secret as key: `web.secret`, otherwise the Velocity forwarding
secret (`config/paper-global.yml`), otherwise the one the hub generates in `network-secret`.
MySQL is not required: drafts stay on each server's disk and sessions
in the hub's memory. A leaf on H2 reports it at startup, because the follow-up data
is not shared there.
*Rejected:* refusing to start without MySQL (planned); nothing in the hub needs it.
*Amendment 2026-10-13:* `web.role` is removed: a server is a leaf exactly when
`web.hub` is set, empty it is the hub. `web.hub` (formerly `web.hub-url`) takes `host[:port]`
(port 8765 by default, or an `https://` proxy address) and the plugin derives the WebSocket URL
`ws(s)://…/ws/plugin` from it. `web.name` becomes the root key `name`.

**⑪ Protocol version.** The `hello` carries `ProtocolVersion.CURRENT` (`1.0`). A major
different from the hub's: the server stays listed as "update required" and the hub no longer
sends it anything (503 `plugin_update_required`). A different minor only adds
fields. A release publishes all jars under a single number.

*Rejected:* Javalin (two Kotlin runtimes), the JDK's HTTP server (no
WebSocket), embedding Jetty in the jar (+3 MB, to relocate).

## Consequences

- A `web` change requires a restart: the web server survives `/artisan reload`.
- Sessions live in memory: a restart requires a new link.
