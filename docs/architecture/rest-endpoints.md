# Hub REST routes — index

> The editor web server (`plugin/hub` module, Jetty 12) serves the editor, its API and its
> WebSockets on `web.port` (8765 by default). Source of truth: the `*Routes.kt` files in
> `plugin/hub/src/main/kotlin/net/artisanmc/plugin/hub/`, assembled by `EditorApi.router`.
> ADR `editor-web-server`.

Since phase F (2026-10), there is no backend. The hub serves its own routes and no longer
imitates the backend's (phase H, issue #44): its servers under `/api/v1/servers`
(the one hosting the hub first, then each leaf by name), and a Project identified by
`<server id>.<folder>` on every server, the hub's included (`f3a1….shop`, `Servers.project`;
the folder alone answers `unknown_project`). No more `network`, WS ticket or `editor-access`: the
session cookie is enough everywhere, and no quota applies.

## Conventions

- **Session required**: every `/api/` route carries a permission (`Router.on(…, permission)`).
  Without a valid session cookie (`__Host-artisan_session` behind HTTPS or `X-Forwarded-Proto: https`, otherwise `artisan_session`; the first wins) → 401 `unauthorized`; without the permission → 403
  `forbidden`. Permissions: `artisan.editor.view` (read), `.edit` (drafts), `.publish`
  (publish, config screens, pack), `.config` (server configuration).
- **Same origin**: a non-`GET` request whose `Origin` header does not name the host
  that answers → 403 `cross_origin`. Same when opening `/ws/editor`. Exception: the
  `crossOrigin` routes (`Router.on(…, crossOrigin = true)`, MCP and OAuth, ADR `mcp-server`) accept any
  `Origin`, with no declared permission; when called from another origin, they do **not** receive
  a session (the cookie never acts for another site) and check their own credentials.
- **Errors**: `{error, message?}`. **The code decides, never the status alone**: a single
  code → status mapping, `ErrorStatus` (`Relay.kt`), shared by all routes. A 404 is
  `unknown_project` (`:project` names no known server/folder, or the server has not
  loaded it), `draft_not_found` (no draft with this id for this owner) or `not_found`
  (unknown `/api/` path, file, player); the editor treats only the last as a "draft
  gone". Unknown method on a known path → 405. Handler exception → 500
  `internal_error`.
- **Relay** (`Relay`): every route that touches a server sends a protocol message
  (see `ws-protocol.md`). Server `updateRequired` → 503 `plugin_update_required`; offline
  → 503 `server_offline`; timeout → 504 `fetch_timeout`; failure → 502 `fetch_error`.
  Every refused response from a server goes through `readError` → `ErrorStatus`: `*_not_found`/
  `unknown_*` 404, `invalid_*`/`missing_blob`/`player_required` 422, `too_large` 413,
  `conflict`/`*_exists`/`addon_immutable`/`draft_*`/`operation_*`/`too_soon` 409,
  `write_error`/`storage_error`/`server_offline`/`plugin_update_required` 503,
  `fetch_timeout` 504, unknown 502.
- **Versioning**: everything under `/api/v1/`; editor and hub ship in the same jar, the API
  is no longer a contract between two deployments (see `versioning.md`).

## Outside the API

| Path | File | Role |
|---|---|---|
| `GET /login/<token>` | `HubServer.kt` | Exchanges the `/artisan editor` link (single use, 60 s) for a 12 h session: `HttpOnly` cookie, `SameSite=Strict`, `Secure` if the request is. Invalid token → `/login?expired=1`. |
| `WS /ws/editor` | `HubServer.kt`, `EditorChannel.kt` | Announcements to open tabs. |
| `WS /ws/plugin` | `PluginChannel.kt` | Network leaves, authenticated by the shared secret at `hello`. No browser session. |
| `GET /resource-pack/<sha1>.zip` | `PackRoutes.kt` | **Public** (Minecraft clients download it when Artisan sends the pack itself and `web.pack-cdn` is off or failed; servers, to hand it to their pack plugin); `PackStore` keeps the last three. Same path on the pack host (`deploy/pack-cdn-worker`). |
| `GET /bedrock-pack/<sha1>.mcpack` | `PackRoutes.kt` | **Public** (servers download it for Geyser); `PackStore` keeps the last three. Not on the pack host. |
| `POST /mcp` | `McpRoutes.kt`, `McpTools.kt`, `McpProjects.kt` | MCP server (stateless Streamable HTTP, JSON responses, ADR `mcp-server`) if `web.mcp: true`. JSON-RPC `initialize` (versions `2025-11-25`, `2025-06-18`, `2025-03-26`), `ping`, `tools/list`, `tools/call`; notification → 202; `GET`/`DELETE` → 405. Caller: `Authorization: Bearer amcp_…` (OAuth token) or same-origin session cookie; without → 401 `WWW-Authenticate: Bearer resource_metadata="…"`; without `artisan.editor.edit` → 403 `insufficient_scope`. Tools: `artisan_overview` (`can_deploy`), `list_documents`, `read_document`, `get_kind_guide`, `read_docs` (embedded user docs, `UserDocs`), `start_draft` (the player's `source: "ai"` draft), `write_document` (`documents_check` on the Project's server, then `update` of the draft; refusal → `isError` with the problems, draft unchanged), `list_versions`; for a client the player allowed to deploy (`allow_publish` and the player's `publish`), `draft_publish` (`expected_revision`, `dry_run`; the draft action `publish`, `author_via` = client name; answer: `changes` with unified diffs, `version`, `previous_version`) and `version_rollback` (`version`, `expected_version` = newest; a draft from the Version, `restoredFrom`, then `publish`). With the hub's pack build (`PackBuilder`): `resource_pack_status` (everyone, `bedrock_sha1` included) and, deploying, `resource_pack_rebuild` (`wait_seconds` ≤ 120; `done: false` when the build outlasts it). `tools/list` offers a principal only the tools it may call (`McpTools.available`). Allowed draft actions: `list`, `read`, `create`, `update`, `write_blob`, `publish` (`McpProjects.DRAFT_ACTIONS`). |
| `GET /.well-known/oauth-protected-resource[/mcp]`, `GET /.well-known/oauth-authorization-server` | `OAuthRoutes.kt` | RFC 9728 and RFC 8414 metadata; base = `X-Forwarded-Proto`/`X-Forwarded-Host`, otherwise the request. `S256` PKCE only, public clients (`none`). CORS `*` without cookie. |
| `POST /oauth/register` | `OAuthRoutes.kt` | RFC 7591: `{client_name, redirect_uris}` → 201 `{client_id: "mcp_…"}`. `https`, or `http` on `localhost`/`127.0.0.1`/`[::1]`; 1 to 10 URIs, no fragment. At most 1,000 clients: beyond that, those older than an hour with no authorization are purged. |
| `GET /oauth/authorize` | `OAuthRoutes.kt` | Known client and `redirect_uri` → 302 to the editor page `/oauth/consent?…`; otherwise `/oauth/consent?error=invalid_client` (never a redirect to an unregistered address). `response_type` ≠ `code` or PKCE missing → back to the client with `error`. |
| `POST /oauth/token` | `OAuthRoutes.kt` | Form. `authorization_code` (`code`, `client_id`, `redirect_uri`, `code_verifier`): 60 s code, single use, burned by a wrong verifier; `refresh_token`: both tokens rotate. Access 1 h, refresh 30 d. Error → 400 `invalid_grant`, unknown client 401 `invalid_client`. |
| `GET /*` | `EditorAssets.kt` | Embedded editor build (`-PwithEditor`); any unknown path returns `index.html`. Without an embedded build: 503 text. |

## Index by routes file

`SERVER` = `/api/v1/servers/:server`, `:server` = server id (UUID from `plugins/Artisan/server-id`). Everywhere the hub returns a server (`servers[].id`, a Project's `serverKeyId`, `server_key_id` of `projects_reloaded`), it is its UUID, the hub's server included; a Project id is `<server id>.<folder>` everywhere (issue #43: no more `local` sentinel).

| File | Routes | Notes |
|---|---|---|
| `AccountRoutes.kt` | `GET/PATCH /api/v1/auth/me`, `POST /api/v1/auth/logout`, `GET /api/v1/servers` | The session's player (UUID, name, permissions) in the shape of an account. `PATCH` saves their preferences (`PlayerPrefs`): `editor_language`, `theme` (`dark`/`light`/`null`), `editor_tour` (`start` → `tourStarted`, `progress`, `complete`, `import`, backend rules); body ≤ 4 KB otherwise 400 `invalid_body`, refused value → 422 `invalid_*`, unknown key ignored. `/servers`: `{servers: [{id, label, online, minecraftVersion, pluginVersion, lastSeenAt, updateRequired}]}`, the hub's server first (`lastSeenAt` from `artisan_servers`). |
| `ServerRoutes.kt` | `GET SERVER/modules`, `/data-sources`, `/models`, `/screens`, `/actions`, `/document-kinds`, `/game-events`, `/player-commands`; `GET` + `PATCH SERVER/server-config`; `POST SERVER/config/read`, `/config/write`; `GET SERVER/players`, `/papi-placeholders`, `/head-texture?id=`, `/player-inventory?player=`; `POST SERVER/data-sources/preview`; `GET SERVER/modules/:module/ui.js?v=`; `GET SERVER/modules/:module/templates/:template` | What the server declares (read from memory, no round trip), its configuration, its config screens and its live data. `ui.js`: a module's editor view (module bundles, level 3, `modules.md`), see below. |
| `ProjectRoutes.kt` | `GET SERVER/projects`; `GET /api/v1/user/projects/:project`; `GET` + `PUT …/files`, `POST …/check` and `GET …/history?path=` under `/api/v1/projects/:project` and `SERVER/projects/:project`; `GET /api/v1/projects/:project/binary?path=`, `GET SERVER/projects/:project/asset?path=`; `GET /api/v1/projects/:project/versions[/:version]`, `GET …/versions/:version/binary?path=` | List, read (`if_hash`, compared to the hash of the loaded state before any Version read: an unchanged poll does not read the files) and an asset's bytes read from the database (`LoadedProjects`, falling back to the server); server off: the read carries `offlineSince` (last presence) and `connection.available` is `false` — the editor opens the project, red status dot, Publish disabled, direct publish (`project_write`, CAS), a no-write check of a deployment's files (`POST …/check` `{files:[{path, content}], deletes}` → `{problems:[{path, stage, message}]}`, `documents_check`, `publish` permission; older server → 503 `plugin_update_required`), a file's history, an asset's bytes. Advertised capabilities (`liveData`, `captureInGame`, `preview`, `canRename`, `canDelete`): rename and delete for a `folder` Project of a server that speaks protocol minor 1. Versions and a file's history read from the database by the hub (`ProjectHistory`, `artisan_versions`), offline server included; without a database, a file's history falls back to the `.artisan/history/` archives. A publish carries the session's `author_id`/`author_name`. |
| `ProjectRoutes.kt` (lifecycle) | `POST SERVER/projects` `{name}` (unknown server: 404 `not_found`, name missing: 422 `invalid_input`); `DELETE /api/v1/user/projects/:project`; `POST /api/v1/projects/:project/rename` `{targetId}` | `artisan.editor.publish`. `project_create` (201 `{project}`), `project_delete` (folder moved to the server's `.artisan-trash/`), `project_rename` (`{projectId, diskId}`, drafts included). `project_exists`/`destination_exists`/`addon_immutable` 409, `invalid_name`/`invalid_path` 422, `unknown_project` 404. Leaf from an earlier release (protocol `1.0`): 501 `plugin_update_required` without sending it anything. |
| `ProjectRoutes.kt` (templates) | `GET …/origins` and `POST …/templates` `{module, template, paths?, replace}` under `/api/v1/projects/:project` and `SERVER/projects/:project` | ADR `module-templates`. `project_origins_fetch` (`{origins}`, `artisan.editor.view`) and `template_copy` (`artisan.editor.publish`, `{written, unchanged}`); existing file with different content without `replace`: 409 `{error: "conflict", conflicts}`, nothing written. `unknown_path`/`invalid_input` 422. Leaf with minor < 3: 501 `plugin_update_required` without relay. |
| `ProjectRoutes.kt` (drafts) | `GET/POST /api/v1/user/projects/:project/drafts`, `GET/PUT/DELETE …/drafts/:draft`, `POST …/drafts/:draft/publish`, `POST …/drafts/:draft/blobs`, `GET …/drafts/:draft/blobs/:hash` | Served by the hub from the database (`ProjectDrafts`), offline server included; only publishing goes to the server (`project_draft_publish`). `owner_id` = the session's UUID. Mutations: `revision` ≥ 1 and `operationId` (`[a-zA-Z0-9_-]{1,100}`, generated if missing). Codes (`ErrorStatus`): `draft_not_found` 404, `unknown_project` 404, `draft_conflict`/`draft_exists`/`draft_closed`/`conflict`/`operation_*` 409, `invalid_draft`/`invalid_blob`/`missing_blob` 422, `storage_error` 503 (the database failed, or is still opening at startup — `LateSuiteData`, issue #42; the same operation sent twice at once gets the other's receipt), without a database, relayed to the server. An operation's receipt does not keep the draft body: on replay, the current draft is returned. `PUT …/drafts/:draft` answers the draft **without** `snapshot` (the editor keeps the one it sent); `GET` and the replay return it whole. |
| `ItemRoutes.kt` | `GET /api/v1/user/projects/:project/items`, `/custom-items`, `/nexo-glyphs`, `/nexo-glyphs/:glyph`; `GET /api/v1/textures/:version/*` | Embedded vanilla catalog (version closest to the server's), Nexo/Oraxen/ItemsAdder items of the Project's server, vanilla textures extracted from the Mojang client jar (`VanillaAssets`, the requested version is ignored), Nexo glyphs. Custom items carry only `{id, label, category}` (spec `custom-items-names-only`): no `textures/custom/…`, the editor keeps a placeholder for them. No `model-bundle` or `models/…` either: the embedded catalog points to 3D icons that are already rendered (`gen-icons.ts`), only the offline generator uses those routes. |
| `SessionRoutes.kt` | `GET /api/v1/editor-sessions`, `DELETE /api/v1/editor-sessions/:session` | `artisan.editor.config`. The open sessions of every server of the database (`Sessions.list`), most recently active first: `{sessions: [{id, playerId, playerName, permissions, serverId, serverLabel, createdAt, lastActiveAt, expiresAt, online, current}]}`. `id` is the public id (SHA-256 of the cookie), `lastActiveAt` precise to the hour, `createdAt` null for sessions opened before migration 32, `online` = a `/ws/editor` tab open on this hub, `current` = the caller. `DELETE` takes the full 64-character id; unknown → 404 `not_found`. Closing one's own session signs out. |
| `AddressRoutes.kt` | `GET` + `POST /api/v1/editor-address` | `artisan.editor.config`. The editor's address on the tunnel server (ADR `editor-tunnel`, decision 8): `{tunnel, connected, url, name, names, suffix}`; without a tunnel `{tunnel: false}`. `POST {name, check}`: `check` only says whether the name is free, otherwise takes it (`""` releases it) and returns `{name, url, login}`, `login` = sign-in link on the new address. Refusals: `taken` 409, `invalid`/`reserved` 422, `too_many` 429, `unavailable`/`offline` 503; without a tunnel 404 `no_tunnel`. |
| `OAuthRoutes.kt` (editor) | `GET` + `POST /api/v1/oauth/consent`; `GET /api/v1/user/mcp/grants`, `PATCH` + `DELETE /api/v1/user/mcp/grants/:grant` | If `web.mcp: true`. `GET` (`view`): `{client: {name, redirectHost}, player, canEdit, canPublish}` for `client_id` + `redirect_uri`; `POST` (`edit`, same origin) `{client_id, redirect_uri, state, code_challenge, approve, publish}` → `{redirect}` to the client, with `code` or `error=access_denied` (`publish` kept only for a player with `publish`). The authorized client acts with the player's permissions minus `config`, and minus `publish` unless allowed, re-read at every permissions report (`Sessions.onPermissions`); without `view`, the authorization is removed. List (`view`): `{grants: [{id, client, createdAt, lastUsedAt, publish}], canPublish}`; `PATCH {publish}` allows or forbids deploying (403 turning it on without `publish`, 404 not the player's); a revocation takes effect on the next call. |
| `PackRoutes.kt` | `PUT SERVER/resource-pack`; `GET /resource-pack/:file`; `PUT SERVER/bedrock-pack`; `GET /bedrock-pack/:file` | The editor sends the zip it built (≤ 100 MB, must start with `PK`); the hub stores it under its SHA-1, uploads it to the pack host (`PackCdn`, answer `{hash, url}` when it took it) and hands it to the server with that address (`applyResourcePack` in process, `resource_pack_updated` for a leaf). The Bedrock pack (`.mcpack`, never on the pack host) goes the same way without the host (`applyBedrockPack`, `bedrock_pack_updated`) and reaches Bedrock players through Geyser. |
| `AiRoutes.kt`, `AiAssistant.kt`, `AiSetup.kt` | `GET /api/v1/ai`; `GET` + `PUT` + `DELETE /api/v1/ai/config`; `GET` + `POST /api/v1/ai/conversations`; `GET` + `DELETE …/conversations/:conversation`; `POST …/conversations/:conversation/messages` | ADR `editor-assistant`. `GET /api/v1/ai` (`view`): `{enabled, model, canUse}`, always served (`enabled: false` without an `ai` section). The rest (`edit`, only with an assistant): `POST` `{project?, server?}` (`server`: the server whose Assistant tab started it, the model's scope; not an id: 422 `invalid_input`) → 201 the conversation `{id, project, server, title, running, createdAt, lastActive, inputTokens, outputTokens}`; `GET` lists them `{conversations: […]}`, the latest first; `GET ?after=N` → the same + `events` from the N-th on (`{seq, type: user\|text\|tool\|notice\|error\|done, …}`, a `tool` carries `name`, `path`, `ok`, `error`, `problems`, `draft`); message `{text}` (≤ 8,000) → 202, the loop runs on the hub (`ai_busy` 409 during a turn, empty or too long 422). Another player's or a forgotten conversation: 404. Conversations are read back from `artisan_ai_conversations` after a restart (a turn it cut gets the notice `ai_interrupted`). Provider errors as an `error` event: `ai_key_refused`, `ai_rate_limited`, `ai_unreachable`, `ai_provider_error`. Without settings, the conversation routes answer 404 (`ai_disabled` to `POST`). `POST /api/v1/ai/translate` (`edit`) `{source, targets[≤12], texts: [{id, text, context?}] (≤100, each ≤4,000), module?}`, texts × targets ≤ 24,000 characters (else 422 `invalid_input`) → `{translations: {id: {lang: text}}, failed: [id], inputTokens, outputTokens}`; a translation whose `{…}` placeholders differ is left out; provider failure or an answer that is not the JSON asked for: 502 `ai_*` (`ai_bad_answer`). `GET` + `PUT` + `DELETE /api/v1/ai/config` (`config`): `{source: file\|database\|none, editable, enabled, provider, model, effort, maxSteps, baseUrl, keyHint, providers, efforts, defaultModel}`, never the key (`keyHint` = `…` + its last 4). `PUT {provider, model, effort, maxSteps, baseUrl, apiKey?}` saves to `artisan_settings` and rebuilds the assistant at once (its conversations go on, from the database); a key left out stays, unless the provider or `baseUrl` changes (`ai_key_required`; none saved: `ai_key_missing`). Invalid field: 422 `invalid_input`, `message` = the field. environment.yml sets an `ai.provider`: 409 `ai_config_in_file`. Database not open or failing: 503 `database_unavailable`. `DELETE` turns it off. |

## Non-obvious flows

- **Publishing** goes through the draft (`POST …/drafts/:draft/publish`); `PUT …/files` remains
  the direct publish (`project_write`, `create: true` for a new Project). Both end in a CAS against the disk,
  after `DocumentCheck`: a Document that would not load → 422 `invalid_documents` `{error, message, problems}`, nothing written.
- **After publishing**, the editor rebuilds the pack in the browser
  (`editor/src/lib/pack/buildServerPack.ts`) then `PUT`s it to the hub: the server computes nothing.
- **Leaf**: the same route serves a remote server; only the transport changes
  (`RemoteServer` instead of `LocalServerLink`).
- **A module's editor bundle** (`GET SERVER/modules/:module/ui.js`, `artisan.editor.view`):
  404 `not_found` without relay if the module's `installed_modules` entry does not advertise
  an `editor_bundle` (a leaf with minor < 2 included). Otherwise the hub serves its copy of the advertised `hash`
  (`BundleCache` of `ServerRoutes`: 8 bundles, 16 MiB, the least recently served goes out), or relays
  `editor_bundle_fetch`; the SHA-256 of the received content must equal the response's `hash` and that
  of the advertisement (stale advertisement, module reloaded: 502 `fetch_error`), then it is kept. 200
  `text/javascript; charset=utf-8`, `X-Content-Type-Options: nosniff`; `Cache-Control: private,
  max-age=31536000, immutable` if `?v=` equals the hash, `no-cache` otherwise. A module with no bundle on the
  server: 404 `not_found`.
- **A module's icon or logo** (`GET SERVER/modules/:module/brand/:file.svg`, `artisan.editor.view`): 404
  `not_found` without relay if the module's entry does not advertise a `brand` naming that file (a leaf with
  minor < 5 included). Otherwise the hub serves its copy (`brands` cache of `ServerRoutes`, by
  `<hash>/<file>`: 64 files, 2 MiB), or relays `module_brand_fetch` and keeps every file of the reply once the
  hash it recomputes equals the reply's and the advertisement's (else 502 `fetch_error`). 200
  `image/svg+xml; charset=utf-8`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src
  'none'; style-src 'unsafe-inline'; sandbox` (opened on its own, it runs nothing); same `Cache-Control` rule
  as a bundle on `?v=`.

## Removed in phase F (do not reintroduce without an ADR)

Accounts (sign-up, email/Google/Discord sign-in, deletion), multiple networks,
members, invitations, access requests, transfers, server keys and link codes,
demo, billing and credits, administration, AI assistant and import sources, copying a
Project to another server, snapshot mirror, broadcast and signed
jar update. Cloud state recoverable at commit `ccade092` (branch `v2`).
