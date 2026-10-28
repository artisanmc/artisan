# WS protocol — hub ↔ server

> The protocol between the hub (the editor's web server, `plugin/hub` module) and the Minecraft
> servers it reaches. Source of truth: `plugin/core/…/protocol/EditorRequest.kt` (incoming
> messages), `plugin/paper/…/ws/WsClient.kt` (a leaf's client), `plugin/hub/…/PluginChannel.kt`
> and `RemoteServer.kt` (hub side). When you change a message, update this file.

Since phase F (2026-10), there is no backend: the protocol inherited from the
backend ↔ plugin relay is spoken by the hub. The **same** set of messages serves two transports:

| Transport | When | Class |
|---|---|---|
| In process | The server that hosts the hub (single server, or a network's hub) | `LocalServerLink` (`core`): the message goes to the WebSocket handlers, the response comes back through `deliver`, 10 s timeout. |
| WebSocket `/ws/plugin` | A network leaf (`web.hub` set) | `WsClient` on the leaf, `PluginChannel` + `RemoteServer` on the hub, 30 s timeout per request. |

The hub interprets no content: every REST route of the editor becomes a protocol message
(`project_read`, `project_write`, `project_draft_publish`…) passed by `ServerLink`
(`core`) to the existing handlers (see `rest-endpoints.md`).

## A leaf connecting

A leaf connects to the WebSocket address derived from `web.hub` (`hubWebSocketUrl`, `PluginConfig.kt`:
`"10.0.0.5:8765"` → `ws://10.0.0.5:8765/ws/plugin`, bare host → port 8765, `https://…` → `wss://…`,
`ws(s)://` URL kept as is) and sends `hello`.
Reconnection with exponential backoff (1 s → 60 s); OkHttp ping every 30 s. The leaf
does not open the socket until its suite database is open (`database_id` unknown,
issue #42): it retries every 2 s. A hub whose database is still opening closes a `hello`
with 1008 ("not open yet: retry"); the leaf comes back through its backoff.

**`hello`** (leaf → hub). Fields sent by `WsClient` and read by the hub:

| Field | Read by the hub for |
|---|---|
| `protocol_version` | `ProtocolVersion.CURRENT` (`"1.4"`). Major different from the hub's: server listed `updateRequired`, nothing more is sent to it (503 `plugin_update_required`). Minor below 1: no `project_create`/`_delete`/`_rename` (501 `plugin_update_required`). Minor below 2 (`EDITOR_BUNDLES`): no `editor_bundle` advertised, so never an `editor_bundle_fetch`. Minor below 3 (`TEMPLATES`): no `templates` advertised; `template_fetch`, `template_copy` and `project_origins_fetch` answer 501 `plugin_update_required` on the hub side. Minor below 4 (`DOCUMENT_CHECKS`): no `documents_check`, the MCP tool `write_document` refuses (`plugin_update_required`). |
| `server_key` | The **network secret** (inherited field name). Compared in constant time; wrong or empty: close 1008. |
| `server_uuid` | The server's Server id (`plugins/Artisan/server-id`): its identity everywhere — `/api/v1/servers/:server`, `server_key_id`, prefix of its Projects (`<server id>.<folder>`), key of `Servers`. Missing, or equal to the hub's (copied folder): close 1008. |
| `database_id` | Identifier of the suite database (`artisan_meta`, generated once). The hub refuses a `hello` whose identifier differs from its own, and any `hello` if it is itself on H2: a network shares one MySQL/MariaDB database. |
| `proxy_name` | The server's name in the network (root key `name`, otherwise the server's folder name). `[A-Za-z0-9_-]{1,64}`. An attribute: the label in the server list; a renamed server keeps its id. |
| `plugin_version`, `minecraft_version` | Shown in the server list; the Minecraft version picks the item catalog. |
| `installed_modules` | `[{id, version, editor_bundle?, templates?}]`: presence of the modules (`GET …/modules`). `templates` = `[{id, title, version, seed_project?, system?, files:[{path, hash, size}]}]` (`TemplateDeclaration.toWire()`, minor 3): the templates the module offers to copy into a Project, without their content (ADR `module-templates`). `system: true` (API 2.12.0): its system elements, kept in the module's folder (`SystemFiles`), never offered for copying. `editor_bundle` = `{sdk, hash, size}` (`EditorBundleDeclaration.toWire()`, minor 2) when the module registered its jar's editor view (`api.getEditorBundles()`): targeted `@artisan/editor-sdk` version, SHA-256 hex of the script, size in bytes; the hub serves it under `GET …/modules/:module/ui.js`. This field and the six following form the server's advertisement, a single `ServerAnnouncement` type (`core/protocol`): built by the server, re-read by `RemoteServer`, served by `EditorServer.announcement()`. |
| `data_sources` | `[{ref, module_id?, schema?, schema_hint?, stability?, key_field?, origin?}]` (`DataSourceReport`). `origin` (API 2.19.0): `runtime`, `content` or `mixed`; absent from an older server = `runtime`. `schema[]` = `{name, type, description}`, `type` being the field's `ModelFieldType` kind (`string`, `number`, `integer`, `boolean`, `list`, `object`, `item` for a field declared by `FieldKind`, as in 1.x; `ltext`, `enum`, `map`… possible since API 2.0.0). The editor treats a kind it does not know as text. |
| `declared_models` | `model/v1` Documents declared by modules: `ModelDeclaration.toWire()`, or the map from `declare(Map)` (`@Sunset`) verbatim. |
| `editor_screens` | Declared config screens: `{id, module_id, label, table, project_id}`. |
| `declared_actions` | Actions registered in `ActionRegistry`, Artisan's included: `{name, args: [ModelField], primary?, module_id?}` (`module_id` missing = core action). The editor derives the selector and the form of module actions from it (`GET …/actions`, ADR `extensible-document-kinds` R1). |
| `document_kinds` | Document kinds registered in `DocumentKindRegistry`, Artisan's included: `{kind, dir, schema_versions, id_prefix?, module_id?}` (`module_id` missing = core kind). The editor compares with the kinds its modules contribute and flags a kind the active server does not list (`GET …/document-kinds`, ADR `extensible-document-kinds` W6). Missing from a `hello` older than 2.1.0: nothing is flagged. |
| `declared_game_events` | Game events registered in `GameEventRegistry` (the `triggers` module's core catalog included): `{name, group, frequency: rare\|normal, context: [ModelField], cancellable, effects: [ModelField], module_id?}`. The editor derives a Trigger's `on:` selector, the `{event.…}` values and the `set_event` form from it (`GET …/game-events`, ADR `triggers-and-variables`). Without a server, the editor reads the core catalog from `testdata/core-game-events.json`. Missing from an older `hello`: empty list. |
| `player_commands` | Player commands declared by modules (`PlayerCommandReport`): `{id, module_id?, name, aliases, permission?, description: {lang: text}, arguments: [{name, type, required, values}], console_allowed, opens_menu?, children: [same shape]}`, without an executor; `opens_menu`: the menu the command opens in place of an executor. Served by `GET …/player-commands`; the editor no longer uses it for editing: a module command is the `command/v1` file that the module's `player_commands` system template keeps in its folder. Missing from an older `hello`: empty list. Returned by `modules_changed` each time a command is added or removed. |
| `server_config` | Editable `config.yml` as dotted keys (never `environment.yml`). |

`RemoteServer` also reads `custom_items_hash` if present (old `hello`); `WsClient` no longer
sends it, the hash follows through `custom_items_changed`.

**`hello_ack`** (hub → leaf): `{session_id, server_id, editor_url, network_name,
resource_pack}`. `server_id` repeats the `hello`'s `server_uuid`, `network_name` the hub
server's name. `resource_pack` is the last pack the hub served to this server
(`{url, hash}`), or `{}`: an object without an address leaves the server with the pack it already has
(`PackUpdate.Incomplete`), `null` would remove it. The hub applies the `hello` (protocol
version, modules, configuration) before sending `hello_ack`: an editor request that follows
the ack sees the server as it announced itself, never with an empty `hello`. Before `hello_ack`,
`WsClient.request` answers `null` without sending anything.

**`session_replaced`** (hub → leaf): another server connected with the same server id;
the old connection is closed (last one wins, see `invariants.md`).

## Messages

Size: Jetty limits an incoming message to 64 KiB by default. `/ws/plugin` raises the limit to
32 MiB (message and frame) once the `hello` is accepted (`PluginChannel.welcome`): Project
read responses, editor bundle. Before that, a larger `hello` closes the connection.

Every request carries a `request_id`; the response repeats it, with type `<request>_result`
(unless noted) and `{ok, error?, message?}`. An unknown type or a missing required field:
the message is ignored (`EditorRequest.parse` returns `null`).

### Hub → server (editor requests)

| Message | Response | Content |
|---|---|---|
| `project_list` | `project_list_result` | `{project_ids, project_roots:[{project_id, identity: "folder"\|"addon", module_id?}], resource_inventory}` — what the server has loaded (snapshot), not a disk scan. |
| `project_read` | `project_read_result` | Request `{project_id, if_hash?}`. Response `{hash, files:[{path, content}], failed:[{path, reason}], binaries:[{path, hash, size}]}`, or `{unchanged: true, hash}` if `if_hash` equals the hash. Binaries advertised, not carried. Cap of 8 MiB of text (`too_large`). Invisible paths excluded (see `invariants.md`). |
| `project_write` | `project_write_result` | `{project_id, operation_id, files:[{path, content, base_hash}], deletes:[{path, base_hash}], renames:[{from, to, base_hash}], binaries?:[{path, content_base64\|null, base_hash}], create?}`. Per-file CAS, all or nothing; conflict: `{error: "conflict", conflicts:[{path, disk}], disk_files}`. The tree that would be written first goes through `DocumentCheck` (like `documents_check`): failure → `{error: "invalid_documents", message, problems:[{path, stage, message}]}`, nothing written. `create` creates a new Project's folder. A replayed `operation_id` returns the response already given. |
| `project_history` | `project_history_result` | `{project_id, path}` → `versions:[{at, content}]`, most recent first, read from `.artisan/history/<path>/`. Nothing feeds this folder any more (`ProjectPublisher.withHistory` is the identity): only earlier archives stay readable. |
| `asset_read` | `asset_read_result` | `{project_id, path}` → `{content_base64, hash}`, read from disk on demand. |
| `project_draft_publish` | `project_draft_publish_result` | Publishing a draft kept by the hub, see below. |
| `project_create` | `project_create_result` | `{project_id}`: empty folder under the core root. Name `[A-Za-z0-9][A-Za-z0-9_-]{0,127}` outside Windows reserved names, otherwise `invalid_name`; already taken (case ignored, or Add-on root) `project_exists`. Minor 1. |
| `project_delete` | `project_delete_result` | `{project_id}`: folder moved to `<root>/.artisan-trash/<id>-<UTC timestamp>/`, never erased. `unknown_project`, `addon_immutable`. Minor 1. |
| `project_rename` | `project_rename_result` | `{project_id, target_project_id}`: atomic move of the folder, `.artisan/` (drafts, journals) included. `destination_exists` (never overwrites), `invalid_path`, `unknown_project`, `addon_immutable`. No recovery journal. Minor 1. |
| `config_read` | `config_read_result` | `{project_id, table}` → `files:[{path, content}]` (folder of YAML or `<table>.yaml`), cap 1 MiB. |
| `config_write` | `config_write_result` | `{project_id, files:[{path, content}], deletes}`: direct write of a config screen table, then reload. |
| `server_config_write` | `server_config_write_result` | `{changes}`: each key validated (known key, default's type, paths under the root, `project:image` refs), `config.yml` rewritten, reload. Response `{server_config?, error?: "invalid_config"}`. Nothing is written if a change is refused. |
| `online_players_fetch` | `online_players_result` | Sorted `players`. Offline or timeout: the route returns an empty list. |
| `papi_placeholders_fetch` | `papi_placeholders_result` | `{placeholders:[{placeholder, expansion}], truncated}`; 2,000 entries max. |
| `head_texture_fetch` | `head_texture_result` | `{id}` (HeadDatabase id, 1–10 digits) → base64 `texture`. Errors `hdb_unavailable`, `head_not_found`, `invalid_input`, `fetch_error`. |
| `editor_bundle_fetch` | `editor_bundle_fetch_result` | `{module_id}` → `{module_id, sdk, hash, content}`: the module's editor view script, as UTF-8 text (≤ 4 MiB, `EditorBundleDeclaration.MAX_SIZE`). `not_found` if the module has no bundle; `too_large` if the JSON would exceed 12 MiB (escaped control characters), under OkHttp's 16 MiB queue. The hub checks that the content's SHA-256 equals the advertised `hash`. Minor 2. |
| `template_fetch` | `template_fetch_result` | `{module_id, template_id}` → `{module_id, template, files:[{path, content_base64}]}`: a template's files as delivered (default version, read-only in the editor). `not_found`. Minor 3. |
| `template_copy` | `template_copy_result` | `{project_id, module_id, template_id, paths?, replace}`: copies the template (or `paths`) into the Project, files and `.artisan/origins.yaml` in one journaled commit (`TemplateCopies`), then reload → `{written, unchanged}`, Project paths. A YAML file goes under the name it has in the Project, otherwise as `.yml`; a `paths` entry may name a file under either extension. An existing file with different content is never overwritten without `replace`: `{error: "conflict", conflicts:[path]}`, nothing written. `unknown_path`, `unknown_project`, `invalid_path`. A system template is only copied into its module's folder (a reset): elsewhere `system_template`. Minor 3. |
| `documents_check` | `documents_check_result` | `{project_id, files:[{path, content}], deletes:[path]}` → `{problems:[{path, stage, message}]}`: would the files load on this server? The files replace or remove those of the loaded Project, then each path of `files` goes through five stages (`DocumentCheck`): `layout` (a Document's location), `yaml`, `schema` (JSON schema of its `schema:` shipped in the jar, `docs/schema`), `actions` (each prefixed action, `guilds:rank_delete`, is declared by this server, with declared arguments and the required ones present; `ActionCheck`, skipped when the server declares none), `engine` (the server's `ProjectReader` on a temporary copy). Nothing is written. The types, schemas and reader are the server's, not the hub's. `invalid_path`, `too_large` (> 2M characters), `unknown_project`, `check_error`. Minor 4 (ADR `mcp-server`). |
| `project_origins_fetch` | `project_origins_fetch_result` | `{project_id}` → `origins: {path: {module, template, version, hash}}`, read from `.artisan/origins.yaml`: where a template's copied files come from. Not from the database: server off, 503 `server_offline`. Minor 3. |
| `player_inventory_fetch` | `player_inventory_result` | `{player}` → `slots:[{slot, stack_yaml, display}]` (0-35, armor 36-39, off hand 40). `player_not_found`. |
| `data_source_fetch` | `data_source_fetch_result` | `{ref, params, filter, sort, limit, args}` → `{rows, truncated}` (50 rows, ≤ 256 KB). `unknown_source`, `player_required`, `fetch_error`. |
| `nexo_glyphs_list` / `nexo_glyph_read` | `nexo_glyphs_list_result` / `nexo_glyph_read_result` | Nexo glyphs read from `plugins/Nexo/glyphs/` (no Nexo API); `{glyphs:[{id, texture, available}]}` then `{content_base64}`. |
| `custom_items_request` | `custom_items_bundle` | No `request_id`. The server answers `{hash, data}`, `data = base64(gzip(zip))`, catalog in `items.json`. |
| `resource_pack_updated` | — | `{url, hash}`: the pack the hub just received for this server, served under `/resource-pack/<sha1>.zip` by the hub and, when `web.pack-cdn` took it, by the pack host, whose address `url` then is. The server applies it (`ResourcePackManager`): delegated to its pack plugin (Nexo, Oraxen, ItemsAdder; `resource-pack.delegate-to-dir`), which sends it, or else added by Artisan to each player's pack stack (`resource-pack.enabled`), players downloading it from `url`. A leaf downloads it through the hub address it knows (`web.hub`). |

### Server → hub (announcements and requests)

| Message | Content |
|---|---|
| `projects_reloaded` | `{projects:[{id, hash}]}` after each reload (`/artisan reload`, write, publish). The hub relays it to the editor's tabs on `/ws/editor`, ids prefixed `<server id>.`. Fire-and-forget. |
| `modules_changed` | `{installed_modules, data_sources, declared_models, editor_screens, declared_actions, document_kinds, declared_game_events, player_commands}`: a module registered after the `hello`; the hub replaces these fields (`ServerAnnouncement.updatedBy`: a missing field keeps its value). |
| `custom_items_changed` | `{hash}`: Nexo/Oraxen/ItemsAdder reloaded; the hub asks for the bundle again. |
| `editor_link` | `{request_id, player_id, player_name, permissions, host?}`: `/artisan editor` typed on a leaf. The hub consults no permission, it takes the ones the leaf read (`artisan.editor.view` required) and answers `editor_link_result` `{ok, url}` or `{error: "too_soon", retry_after}` / `invalid_input`. Leaf timeout 15 s. |
| `editor_permissions` | `{players: {uuid: [permissions]}}`: every minute, the editor permissions of online players. The hub applies them to the sessions this server issued and closes those of a player without `artisan.editor.view`. No response. |
| `editor_logout` | `{request_id, player_id}`: `/artisan editor logout` typed on a leaf. The hub closes all the player's sessions and answers `editor_logout_result` `{ok, closed}`. |
| `editor_sessions` | `{request_id}`: `/artisan editor sessions` typed on a leaf. The hub answers `editor_sessions_result` `{ok, sessions: [{id, player_name, permissions, server, last_active_at, online}]}`, `online` meaning a tab is open on the hub. An older hub does not answer: the leaf says the hub is offline after 15 s. |
| `editor_revoke` | `{request_id, id}`: `/artisan editor revoke` typed on a leaf. The hub closes the one session whose public id starts with `id` and answers `editor_revoke_result` `{ok, revoked}`. |

### Private drafts (`project_draft_publish`)

Drafts live in the suite database and the hub serves them itself (`ProjectDrafts`,
ADR `server-identity-and-versions`), offline server included: `list`, `read`, `read_blob`,
`create`, `update`, `discard`, `write_blob` never go to the server. `owner_id` is the UUID of the
session's player, supplied by the hub. Mutations: `operation_id` (receipt in the database, replayable);
an existing draft requires `expected_revision`. Blobs go into `artisan_contents`.

Only publishing goes to the server: `project_draft_publish` `{project_id, operation_id, draft,
blobs: {hash: base64}, author_id, author_name}` (the binaries the draft changes).
`DraftPublication` (`core`) checks each file against the disk (compare-and-swap), writes everything
in one commit with its receipt (`.artisan/transactions/`), answers `{ok, wrote}`, `conflict` or `invalid_documents` (the draft's tree goes through `DocumentCheck` before the CAS, like `project_write`), **then**
reloads. The hub only marks the draft published after this response; a lost response is
replayed under the same `operation_id`, which the server recognizes.

### Commercial quota

`ProjectMutations` still applies a quota if a mutation carries `commercial_policy`. The hub
never sends one: no limit applies.

## `/ws/editor`

Browser ← hub WebSocket (`EditorChannel`). Opening: session cookie carrying
`artisan.editor.view` and an `Origin` header of the same host, otherwise 403. The hub only sends
`projects_reloaded` `{server_key_id, projects:[{id, hash}]}` (`server_key_id` = server id, the hub's
included); from the browser it reads nothing but ignores the editor's heartbeat (`ping` every 60 s,
under the 5 min idle timeout).
The editor opens it directly (`new EditorWs(handlers)`), without a ticket: the cookie is enough, and
opens it again when it drops (1 s, doubling up to 30 s).
Each socket is tied to its session's public id: an open socket is what the Sessions screen calls
"Editor open" (`EditorChannel.online`, this hub only: ADR `peer-servers` sends one network's
editing traffic through one server at a time). When a session is closed here (`Sessions.onClosed`:
revoke, logout, permission loss), its sockets are closed with code **4401** `session_closed`; the
editor then stops reconnecting and goes back to `/login?expired=1`.

## Removed in phase F (do not reintroduce without an ADR)

`draft_update`, application-level `ping`/`pong`, `project_deleted`, `project_copy`,
the old `project_rename` with `operation_id` and journal (+ `hello.project_rename_results`), `asset_write`, `plugin_update`,
`member_add`, `import_sources_list|read`, `bundle_available`, as well as the `hello` fields
`capabilities`, `content_version`, `snapshot_hashes`, `local_project_ids`,
`editor_access_mode`. Cloud state recoverable at commit `ccade092` (branch `v2`).

## Plugin side: one handler per message

An incoming message becomes an `EditorRequest` (`core`, `protocol` package), a sealed type.
`SyncedMenuProvider.dispatch` routes each type through an exhaustive `when`; adding a message
without a handler does not compile.

| Handler | Module | Messages |
|---|---|---|
| `ProjectReads` | `core` | `project_list`, `project_read`, `project_history`, `asset_read`, `config_read` |
| `ProjectWrites` | `core` | `project_write`, `config_write`, `project_draft_publish`, `project_create`, `project_delete`, `project_rename` (disk: `ProjectFolders`) |
| `ServerQueries` | `paper` | `online_players_fetch`, `papi_placeholders_fetch`, `head_texture_fetch`, `player_inventory_fetch`, `editor_bundle_fetch`, `data_source_fetch`, `server_config_write`, `nexo_glyph*` |
| `TemplateRequests` | `core` | `template_fetch`, `template_copy`, `project_origins_fetch` (disk: `TemplateCopies`, `ProjectOrigins`) |
| `DocumentChecks` | `core` | `documents_check` (no writes: `DocumentCheck` on a temporary copy) |
| `SyncedMenuProvider` | `paper` | `hello_ack`, `resource_pack_updated`, `session_replaced`, `custom_items_request` |

The `core` handlers see Projects only through `ProjectWorkspace` (snapshot,
disk executor, `reload(projectIds)` which only re-reads the named Projects: each write
re-reads its own, a rename the old and the new id). Every response goes out through `Replies`; no
blocking I/O on the WebSocket callback thread (see `invariants.md`).
