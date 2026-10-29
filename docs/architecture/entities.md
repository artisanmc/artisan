# Data model — what persists where

Since phase F (2026-10), Artisan has no central database any more: no PostgreSQL, no accounts, no
networks in a database. Everything that lasts lives on the disk of each Minecraft server; the hub
only keeps in memory the state of the connected servers (editor sessions are in the suite database). ADR `editor-web-server`.
The old cloud model (45 tables, 66 Drizzle migrations) is recoverable at commit `ccade092`
(branch `v2`).

## Entities

| Entity | Identity | Where |
|---|---|---|
| **Server** | Server id (UUID from `plugins/Artisan/server-id`), the hub's server included: routes `/api/v1/servers/:server`, `serverKeyId`, `server_key_id`, prefix of Project ids, keys of `Servers` (issue #43). The name (`name`, otherwise the server folder's name; `proxy_name` of the `hello`) is an attribute, the displayed label | `artisan_servers` (suite database): `uuid` of the file `plugins/Artisan/server-id`, `name`, `last_seen` refreshed every minute, `running` (false after a clean shutdown), `editor_url` and `internal_url` (where its `/ws/plugin` answers, ADR `peer-servers`) (`ServerRegistry`). A changed `name` renames the row; a server id already running under another name (copied folder) or a name held by another server id is refused at startup. The hub lists the servers known from the table, stopped ones included; without a database, a disconnected leaf stays listed until the hub restarts (`Servers`, `RemoteServer`). Artisan's tables migrated by `SchemaMigrator` (`artisan_schema_version`). |
| **Network** | Unique, unnamed; `network_name` of the `hello_ack` = the hub's server name | Implicit: the hub and the leaves that share its secret. |
| **Project** | `<server id>.<folder>` on any server, the hub's included (`f3a1….shop`, `Servers.project`); `externalId` = the folder | Disk: `plugins/Artisan/modules/<folder>/`, or the root an add-on registers (`ProjectRootRegistry`, `identity: addon`). See `project-files.md`. |
| **Private draft** | `draft_id` in a Project, owner = the player's UUID | Suite database: `artisan_drafts` (JSON envelope, key = hash of `draft_id`, columns `status` and `updated_at` for the purge, `owner` for the list: a player only reads their active drafts, rows from before the column carry `''` until their next commit and are still read), receipts in `artisan_draft_receipts` (result **without** the draft body: on replay, the draft is reread; `created_at`), blobs in `artisan_contents` (`ProjectDrafts`, hub; access through `SuiteProjectData`, paper). Closed drafts (published, abandoned) and receipts purged after 30 days (`DraftRows.KEEP`), once a day. The old `.artisan/drafts/` are no longer read. |
| **Publication journal** | `operation_id` | Disk: `<project>/.artisan/transactions/` (in progress) and `.receipts/` (receipts replayed identically). |
| **Base of a system element** | SHA-256 hash of the shipped file | Disk: `<project>/.artisan/bases/<hash>` (`SystemFiles`): the content of the version that an origin of `.artisan/origins.yaml` names, base of the three-way merge at the next version. Private; deleted when no origin names it any more. |
| **Editor session** | Random token (cookie `__Host-artisan_session` over HTTPS, `artisan_session` otherwise); carries the player's UUID, name and permissions | `artisan_editor_sessions` (key = SHA-256 of the id, never the id) + the hub's memory cache (`Sessions`). Expires after `web.session-days` (7) days without a request, survives restart. Without a database: memory only. `created_at` (migration 32, null before) and `kind` (`session`, or `link` for a stored sign-in link, migration 33) let `Sessions.list` show the open sessions (Settings → Sessions, `/artisan editor sessions`); its public id is the row key. |
| **MCP client** | `client_id` (`mcp_…`), registered by the client itself (RFC 7591) | `artisan_mcp_clients` (name, `redirect_uris`, date). Public, no secret: PKCE stands in. 1,000 at most; beyond that, those older than an hour that no authorization names are purged (ADR `mcp-server`). |
| **Assistant settings** | `ai` | `artisan_settings` (`SettingRows`, migration 34, a JSON value per name): provider, API key **in clear** (whoever reads the database controls the network already), model, effort, steps, base URL. Written from Settings → Assistant (`PUT /api/v1/ai/config`), read by every server of the database once it is open and again every 30 s (`AiSetup`: a save on one reaches the others sharing the tunnel address); environment.yml's `ai` section wins over it. Never sent back to the editor but its last four characters (ADR `editor-assistant`). |
| **Assistant conversation** | UUID; one player | Hub memory only (`AiAssistant`): the thread's events, the tokens used. 10 per player, forgotten after 6 h without activity or on restart; the drafts it wrote stay (ADR `editor-assistant`). |
| **MCP authorization** | UUID; one player, one client | `artisan_mcp_grants` (`McpGrantRows`): player, origin server, permissions (the player's minus `config`, updated by their permission reports, deleted without `view`), `allow_publish` (false by default: `publish` counts only once the player allowed the client to deploy, ADR `mcp-server` decision 9), then code (60 s, hashed, PKCE challenge), access token (1 h) and refresh token (30 d), **SHA-256 hashed**, rotated at each refresh. Reread on each `/mcp` call: a revocation takes effect on the next one. Before the database opens: memory only. |
| **Cooldown** | Cooldown id + subject (player UUID, `*` for `scope: global`) | `artisan_cooldowns` (`expires_at` in epoch ms, `CooldownRows`) + the server's memory (`CooldownStore`), the only thing read by a cooldown test. Written on each cooldown started (database write thread), a player's own reread at their connection, global ones every 30 s (`CooldownSync`, paper): they survive restart and follow a player across the network. Expired rows purged once a day. Trigger delays go through it too (`api.cooldowns`, id `triggers:<project>/<id>`). Without a database: memory only, lost at restart. |
| **Seen player** | Player UUID | `artisan_players` (`PlayerRows`: name, `first_seen`, `last_seen`, `playtime_ms`, all in epoch ms), shared by the network. Read at connection (`AsyncPlayerPreLoginEvent`, off the game threads), written at join, every 5 min (this server's share of playtime) and at quit (`PlayerSync`, paper). Online players are in memory (`PlayerRecords`, runtime): templates read `{player.first_seen}`, `{player.last_seen}` (end of the previous visit) and `{player.playtime}` without waiting for the database. Without a database: memory only, from the join. |
| **Login link** | Single-use token | Hub memory, 60 s, one per player per minute. |
| **Editor preferences** | Player UUID | Hub disk: `plugins/Artisan/editor-prefs/<uuid>.json` (`PlayerPrefs`): language, theme, guided tour progress. Atomic write, known keys only. |
| **Resource pack** | SHA-1 of the zip | Hub disk: `plugins/Artisan/cache/resource-pack/<sha1>.zip` (`PackStore`, last three, one pack per server built by the editor). Copied to Artisan's pack host when `web.pack-cdn` is set (`PackCdn`, ADR `pack-host`): `packs/<sha1>.zip` in R2, kept while the hub touches it (startup, daily). Last applied pack: `cache/resource-pack.json` on each server. |

No user: the identity in the editor is the Minecraft player who requested the link,
their rights are their `artisan.editor.view|edit|publish|config` permissions at the time of the
request (`artisan.editor` grants them all). Access is given with a permissions plugin
(LuckPerms…), not by invitation.

## Plugin files (`plugins/Artisan/`)

| File | Content | Written by |
|---|---|---|
| `config.yml` | Editable settings (language, resource pack, pool sizes…) | The admin, or the editor (`server_config_write`, validated key by key). |
| `environment.yml` | `name` (server name), `web.*` (port, bind, url, hub, secret, tunnel), database credentials and `dev.editor-bundles` (a module's editor view read from a file) | The admin only; never read nor written by the editor. |
| `network-secret` | Network secret generated by the hub when neither `web.secret` nor Velocity provide one; peers of the same database use `network_secret` from `artisan_meta` (ADR `peer-servers`) | The hub, once. |
| `tunnel-secret` | The editor tunnel's secret; the `<id>` address on the tunnel server is derived from it (ADR `editor-tunnel`). The address name (`survie.artisanmc.app`) is only kept by the tunnel server (`TUNNEL_NAMES_FILE`), which returns it on each connection | The hub, once, if it opens a tunnel (by default, without `web.url`). |
| `modules/` | The Projects (module folders) | The plugin (only writer), on an editor action, or the admin by hand then `/artisan reload`. |
| `editor-prefs/<uuid>.json` | A player's editor preferences (`PATCH /api/v1/auth/me`) | The hub. |
| `cache/minecraft/<version>/` | Vanilla textures extracted from the Mojang client jar (SHA-1 verified) | The hub, at the first texture requested. |
| `cache/resource-pack/`, `cache/resource-pack.json`, `cache/asset-index.json` | Served packs (hub), last applied pack, asset index | `PackStore`, `ResourcePackManager`, `AssetCatalog`. |
| `database/suite.mv.db` | Default H2 database | The suite's plugins. |

## The suite database

`environment.yml` → `database.type: h2 | mysql | mariadb`. Artisan creates its own tables there
(`artisan_servers`, Versions, drafts…) and lends a connection pool to each suite plugin
(`DatabaseApi`, `@Beta`), each plugin bringing its tables and its migrations (ADR
`suite-foundation-database`). All tables start with `database.table-prefix`
(`artisan_` by default): `{prefix}servers` for Artisan, `tablePrefix(module)` =
`{prefix}{module}_` for a plugin. The prefix in use is noted in
`plugins/Artisan/database/table-prefix`; changed under a database that holds the tables of
the old one, `dataSource()` is refused for all plugins (`TablePrefix.checkUnchanged`). On a network, MySQL or
MariaDB lets servers share this data; a leaf on H2 flags it at
startup, without refusing to start (drafts and sessions do not need it).

## What the hub retains about a server

Read at the `hello`, updated by `modules_changed`, `custom_items_bundle` and
`server_config_write_result`: installed modules, data sources, declared models, config
screens, `config.yml`, custom items, Minecraft and plugin versions, protocol compatibility.
None of this is written to disk on the hub side. For the hub's server, these values are read
directly from the plugin on each request.

## History

- `.artisan/history/<path>/<ms>`: archives of a file from before Versions, read by
  `project_history` when the database is unavailable. No longer fed.
- **Versions** (ADR `server-identity-and-versions`): `artisan_versions` (server, `project_key`
  from `.artisan/project-id` or `addon:<id>`, last folder, manifest hash, manifest
  `t|b <hash> <size> <path>`, author UUID + nickname or nothing, `author_via`: the AI client
  it was deployed through, if any, date) and `artisan_contents`
  (hash → bytes, text and binaries, stored once; `MERGE` H2 / `INSERT IGNORE` MySQL, two
  servers may insert the same hash). Each server records its own at
  each Snapshot whose manifest differs from the previous one (`SyncedMenuProvider.onSnapshot` →
  `VersionRecorder` (core), thread `Artisan-versions`), **in one transaction**; `.artisan*`
  outside the manifest. A binary's bytes are reread from disk at recording time and
  rehashed: if they no longer match the Snapshot's hash (publication or edit in the meantime),
  the entry is not stored (warning), the next Version will pick it up.
  H2 to MySQL switch: `EmbeddedImport` copies over at first startup the server id's Versions, contents and
  drafts from the H2 file (ids reassigned), once: the import and its mark
  `imported:<server id>` in `artisan_meta` are one transaction, a failed import reruns at the
  next startup, a completed import never reruns. Migrations (`SchemaMigrator`): each
  non-replayable step (`ADD COLUMN`, `CREATE INDEX`, `ADD CONSTRAINT`) carries an `applied` predicate
  read from the JDBC catalog, because MySQL auto-commits DDL; `GET_LOCK` not obtained = error.
  `artisan_server_state` (one JSON per server, rewritten at each load **if all the Versions
  of the load were recorded**: otherwise the previous state stays, consistent with the files
  served): the content of `project_list` and, per Project, the Snapshot hash, the failed
  files and `.artisan/editor.yaml` — a `LoadedState` (`core/protocol`, field `schema`, absent from
  older rows which read as `schema: 1`; an unknown field is ignored). The hub reads the list, the Projects and their assets from these two
  tables (`LoadedProjects`, implemented by `SuiteProjectData` in `paper`, which keeps the parsed state
  of each server for 5 s and drops it as soon as that server records or announces a reload);
  a folder's latest Version is read by two indexed queries, the full history is
  only loaded by the history routes. The reload is only announced once recorded.
  Without a database, it relays to the server.
  The author comes from `author_id`/`author_name` of the hub's publication messages;
  `restored_from` from the published draft's `restoredFrom` (restoring a Version loads its text
  and binaries, read from the database, into the draft; "Restore and publish" opens the review).

## Phases (narrative)

- April–June 2026: Bun/Hono backend + PostgreSQL, accounts, networks, server keys, branches.
- August 2026 (`server-disk-only-storage`): Projects' content leaves the database for the server's
  disk; the backend only relays.
- September 2026: drafts and Versions in the database, snapshot mirror (`snapshot-mirror-and-backend-history`).
- October 2026 (self-hosting plan, phases A to F): the plugin serves the editor; drafts
  on disk; hub + leaves network; the backend and all its tables are removed.
