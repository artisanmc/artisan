# Plugin `/artisan` commands

Dev-facing detail. Source of truth: `plugin/paper/src/main/kotlin/net/artisanmc/plugin/command/ArtisanCommand.kt`.
The user-facing table (EN) lives in `docs/site/getting-started/install-admin.md` —
the two must change together.

| Subcommand | Effect |
|---|---|
| `menu <menu_id>` | Permission `artisan.menu`. Opens a menu. Players only (`in_game_only` otherwise). Resolves the language via `lang.playerLang(sender)`. |
| `reload` | Permission `artisan.admin`. `reinit(loadPluginConfig())`, which recreates the provider and loads it: a single read from disk. Picks up `language` / `per_player_language` and hand edits made on disk. Does not restart the web server: `web.*` needs a restart. |
| `sync status` | Fixed message pointing to the logs (leftover of cloud sync). |
| `sync reject` | Permission `artisan.admin`. `menuProvider.unload()/load()` — reloads from disk and, on a leaf, reconnects to the hub. |
| `editor` | Editor login link. See below. |
| `dump-title <menu_id> [lang]` | Permission `artisan.admin`. **Diagnostic**, not documented user-side. Compiles the menu title and prints each step: the exact MiniMessage emitted, the offset advances, and the MC X cursor at each layer boundary. Use it when the in-game position differs from the editor preview. |
| `click <token>` | No permission, absent from completion and help. **Internal**: the command a `chat_button` line runs when clicked (`/artisan:artisan click <token>`, `ChatButtons`). A token that is unknown, expired, used up or clicked by another player than the one it was sent to does nothing. Tokens live in memory, a restart forgets them. ADR `triggers-and-variables` §7. |

Removed in phase F: `link <code>` (cloud linking), `member add <email>` (console access),
and with them `editor.access_mode` / `editor.console_only`.

## `editor`

Without `artisan.editor.view`: refused. From the console: a shared **Console** identity
(`ArtisanCommand.CONSOLE_ID`, nil UUID, name `Console`), with the console's permissions,
and the link printed in plain text (`editor_link_console`, nothing to click). Without `web.url`, the address
is `server-ip`, otherwise `localhost`. The permission refresh never touches this session
(it only reads online players): it lives until it expires or `editor logout`.

**Standalone server or hub** (`web.hub` empty, web server started): prints a single-use
`<base>/login/<token>` link, valid for 60 s, one per player per minute
(`hub/Sessions.kt`). `<base>` is `web.url`, otherwise `http://<address the player joined on>:<port>`.
The opened session carries the player's UUID and their `artisan.editor.view|edit|publish|config` permissions
at the time of the request (`artisan.editor` grants them all). Web server absent (`web.enabled: false`,
port taken, Jetty not downloaded): `editor_disabled`.

**Network leaf** (`web.hub` set): the server reads the same permissions and asks the hub for the link
over `/ws/plugin` (`editor_link`, reply `editor_link_result`). The hub checks no
permission itself. `<base>` is the hub's `web.url`, otherwise the address the player joined on, with
the hub's port. Hub unreachable: `editor_hub_offline`.

**Permission refresh**: every minute, the server sends the hub the editor permissions of its
online players (`editor_permissions` from a leaf, direct call on the hub). They
replace those of the sessions **this server** issued (column `origin` = server id); without
`artisan.editor.view`, those sessions are closed. Another server does not touch sessions
it did not issue (LuckPerms permissions are per server).

## `editor sessions` and `editor revoke <id>`

Permission `artisan.editor.config`. `sessions` lists the open sessions of every server of the
database (`Sessions.list`: the `artisan_editor_sessions` rows of kind `session`, then those this
hub holds in memory alone), most recently active first: player, origin server's name, last
activity (`expires_at` minus `web.session-days`, so to the hour), rights, and "editor open"
when a tab of that session holds `/ws/editor` on this hub (`EditorChannel.online`). Each line
shows the first 12 characters of the session's public id (SHA-256 of the cookie, the row key)
with a click that runs `revoke`. `revoke <id>` closes the one session whose id starts with
`<id>` (at least 8 characters, `Sessions.MIN_PREFIX`); none or several: `editor_session_not_found`.
The closed session's open tabs receive close code 4401 and go back to sign-in.
On a leaf, both go through the hub (`editor_sessions`, `editor_revoke`).

## `editor logout [player]`

Closes all of a player's editor sessions, whatever the origin server. Without an argument:
yourself (in game), Console (from the console). `Console` is named like a player. With a player (online or known to the server): `artisan.admin`, console included.
On a leaf, goes through the hub (`editor_logout` → `editor_logout_result {ok, closed}`).
