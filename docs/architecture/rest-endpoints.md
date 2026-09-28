# REST endpoints — index

## Network access options

`userNetworks.ts`: `GET /api/v1/networks/:idOrSlug/access-options` requires a
signed-in account but no membership. Returns its membership status, the effective
mode, its own ready-to-copy command and only console-enabled server labels/status.
Any console-enabled server selects console access for the entire network;
`POST …/access-requests` then returns `409 console_required`. Manual invitations
remain available. The editor polls every three seconds until membership exists.

## Temporary demo access

`demo.ts` exposes `GET /api/v1/demo` (recover only; never creates or renews),
`POST /api/v1/demo` (create/recover). The demo is disposable: no claim into an account
(`/demo/claim` removed 2026-09-27, ADR `server-only-projects`); it leaves only through export.
Since 2026-09-28 a demo publishes nothing: `PUT …/files` is refused, its work goes through
the drafts routes (`demo_quota_exceeded` 413, `demo_rate_limited` 429 before any write).
The HttpOnly `artisan_demo_session` cookie selects a guest principal only for its
exact Project. Mutations require the editor Origin and `X-Artisan-Demo-CSRF`;
successful effective writes expose `X-Artisan-Demo-Expires-At` and update cookie
expiry. Common files/drafts/assets/items routes use that principal without fake
accounts or servers. Other projects still require account membership.
Claim requires an account and `{operationId, networkId, projectId?}`. Revoked proof
is retained for retries; without its cookie an owner-bound claim may resume using
all three fields. A different current demo cookie never selects a new claim target.

Deprecated `GET`/`POST /api/v1/server-keys` are admin-only. Normal account provisioning
remains under `networks/:id/server-keys`; plugin `/link` is unchanged.

> **Source de vérité = les fichiers de routes** (`backend/src/routes/*.ts`). Ce doc ne recopie pas
> chaque signature (elle dériverait) : il dit **quel fichier ouvrir** pour quelle surface, les
> conventions transverses, et les **flux non-évidents** qu'un skim du code ne révèle pas.
> Pour les codes d'erreur exacts, le body et le statut : lire le handler.

## Conventions

- **Public pricing catalog**: `modules/billing/userRoutes.ts` exposes public `GET /api/v1/billing/plans`, active plans only, ordered by `sortOrder` then ID. It returns the saved currency, cents and interval plus `description`, `highlighted`, `features` (newline text), `sortOrder`, `editorPro`, and `purchasable` (whether a Stripe price exists), without Stripe identifiers. `GET /api/v1/billing/editor-offer` exposes `quota`, `proQuota`, `freeServers`, `proServers`, `freeCollaborators`, and the published Pro offer (`proMonthlyPriceCents: 900`, `proYearlyPriceCents: 7000`, `proCreditsPerMonth: 500`, `currency: eur`), per Network. Admin create/update validates and persists presentation metadata and Pro eligibility in `modules/billing/adminRoutes.ts`.

- **Network plan limits**: `POST /api/v1/networks/:id/server-keys` returns `409 server_limit_reached` at 2 Free or 10 Pro servers. Invite acceptance and access-request approval return `409 collaborator_limit_reached` for a third Free collaborator; plugin console access returns `member_add_result` with that error. One owner is excluded from the collaborator count. Existing entries remain after Pro expires.

- **Pricing authentication and checkout**: Discord `/start?next=...` keeps a local
  return path in a signed, expiring cookie bound to OAuth state; unsafe paths and
  mismatched context fall back to `/account`. Google retains the same local-path
  behavior. Billing checkout and portal require `manage_billing`; an existing
  nonterminal subscription returns `409 subscription_exists` and must be managed
  through the portal. Checkout success/cancel and portal URLs retain `networkId`;
  subscription checkout also retains `plan`, including configured return URLs.

- **Editor guided tour**: `auth.ts` exposes `user.editorTour` in signup/login and
  `GET/PATCH /api/v1/auth/me`. `PATCH` accepts `editor_tour` actions `start`,
  `progress` (`step: 0..6`), `complete`, or `import` (`step`, `completed`).
  A row lock serializes changes: `start` returns top-level `tourStarted: true`
  only for the caller that initialized an unseen account; `import` also applies
  only when unseen. Progress never clears completion. The state belongs to the
  authenticated account, independently of the demo principal or current Project.

- **Hosted projects (2026-09-13, account endpoints removed 2026-09-27 — ADR `server-only-projects`)**: `userNetworks.ts` exposed
  `GET/POST /api/v1/networks/:id/hosted-projects` and `GET .../templates`.
  Creation takes `{operationId, folderName, name, minecraftVersion, templateId: "vanilla"}`;
  Network detail includes hosted summaries. `userProjects.ts` adds capabilities,
  selected `minecraftVersion` and `connection.available` to identity metadata.
  Hosted `/items` requires that exact selected catalog; a missing catalog returns
  `404 unknown_version`, without substituting another patch or minor version.
  `projectContent.ts` serves authorized `GET .../binary?path=…` and accepts one
  mixed PUT batch with `operationId` and `binaries: [{path, content_base64, base_hash}]`.
  Existing server URL façades remain supported. Missing binaries return 404,
  definitive operation mismatches/expiry return 409, uncertain storage failures 503.
- **Private draft assets**: existing `userAssets.ts` endpoints accept `draftId`.
  Mutations require `draftRevision`, `Idempotency-Key`, frozen `draftSnapshot` and
  `draftName` in JSON or multipart fields. Blob staging precedes one draft CAS;
  responses include the resulting `draft` (including DELETE, now 200 in draft scope).
  Retry reuses the exact original request. `draft_conflict` is 409 with the current
  owner-bound draft; public files and resource packs change only on explicit publish.
  Asset/font texture routes accept `draftId`, require the cookie and membership,
  and return `Cache-Control: private, no-cache`; browser image fetches need credentials.
  Binary transport timeouts/offline/read errors return `503 storage_unavailable`,
  not 404. Server asset reads share the short-lived project tree and cache verified
  bytes by server, disk project, path and content hash; authorization still runs
  per request. The disk binary RPC allows 30 seconds for queued recovery/reload.
  Draft images unchanged from their binary baseline can reuse that exact hash;
  private replacements still read their owner-bound draft blob first.
- **Image classification**: `userAssets.ts` delegates to `assetHandlers.ts`.
  Image creation accepts optional multipart `usages` (a JSON array string);
  PATCH accepts a JSON array of `button` and/or `menu`.
  Legacy `background` and `decoration` values are accepted and normalized to `menu` on read/write.
  Duplicates are normalized; invalid values/types and usages on fonts return 400.
  The image's YAML descriptor stores the list; no DB schema or PNG duplication.
  Missing `usages` preserves legacy inference in the editor; `[]` explicitly
  leaves an image unclassified. Rename/resize preserve the list; duplicate copies it.

- **Project URLs (2026-09-14)**: identity GET resolves the full location before
  `resolveProjectStorage`; content/draft/history APIs retain immutable internal IDs.
  Demo claim returns additive `urlId` (current hosted folder) beside `projectId`
  (stable internal anchor), including retries. Existing Network/Server slugs stay unchanged.

- **Project rename (2026-09-12)**: `projectContent.ts` exposes
  `GET /api/v1/projects/:projectId/capabilities` and `POST .../rename` with
  `{operationId, targetId}`. The internal ID remains stable; the browser URL follows the folder ID. Rename
  requires `publish_content`; add-on roots cannot rename. Success is 200;
  an uncertain remote outcome is 202 `rename_pending`, retried using the same ID.
  Server project listings retain `project_ids` and add `projects` with immutable
  anchors and `capabilities.canRename`. Clients cannot select another storage.
  `pending_renames` identifies reserved roots omitted from listings without hiding
  unrelated projects. Deletion returns 409 `rename_in_progress` until the operation
  resolves; a thrown transport send still returns 202 with the durable operation ID.
  `projects` also retains the existing pending anchor with
  `pendingRename: {operationId, targetId, status: "pending"}` and disabled rename
  capability, so reloads can restore its status/retry without discovering aliases.

- **Project content storage (2026-09-12)**: `routes/projectContent.ts` exposes
  `GET/PUT /api/v1/projects/:projectId/files` and `GET .../history?path=…`, keyed
  by immutable internal Project ID. Cookie authentication and the storage resolver
  check membership before selecting the configured adapter; writes additionally
  require `publish_content`. The client cannot choose a storage location. File
  bodies are limited to 8 MiB; reads preserve binary descriptors and conditional
  hashes, conflicts preserve `disk_files`. Existing server-scoped file/history
  routes use the same handlers after server authorization, including unanchored
  disk projects. Hosted storage returns `storage_unavailable` until enabled.

- **Account deletion**: `routes/auth.ts` exposes `POST /api/v1/auth/delete-account/request` (session required, 204 after SMTP acceptance; 429 cooldown, 503 email unavailable) and `POST /api/v1/auth/delete-account` (`{token}`, explicit confirmation, 204). Invalid/expired/spent/email-changed tokens return 400; an active subscription on a network losing its last owner returns 409 without consuming the link. There is no destructive GET. Emailed tokens use a URL fragment on `/delete-account` and are removed before analytics initialization.

- **Project drafts (2026-09-11)**: `routes/projectDrafts.ts` owns
  `/api/v1/user/projects/:projectId/drafts` (internal Project ID): list/create,
  read/update/discard `/:draftId`, and explicit POST `/:draftId/publish`.
  Authentication, active Project, network membership/capability and draft ownership
  are checked on every request. Mutations require `revision`; stale writes return
  409 `draft_conflict`. Creation IDs are caller-generated to make lost responses
  recoverable without duplicating drafts. Bodies are bounded to 8 MiB, trees to
  5,000 relative paths. Publication uses the stored baseline and existing plugin
  compare-and-swap; pre-commit rejections leave the draft active, while an uncertain
  storage failure can finish through journal recovery. `publish_content`
  is separate from `edit_content`; current member/owner roles retain both rights.
  No MCP tokens or delegated grants are exposed yet.
  Server drafts now resolve through the bound `ProjectStorage.drafts` port.
  **2026-09-26** (ADR `snapshot-mirror-and-backend-history`): server-project drafts
  live in the backend again (`SqlDraftStore`), images included (`POST /:draftId/blobs`,
  `GET /:draftId/blobs/:hash`). List and read return each active draft **rebased** on
  the current Snapshot (not persisted): files changed only on the server advance, and
  files changed on both sides come back in `draft.conflicts: [{path, disk}]`. Publish
  sends text, images, deletes and renames in one `project_write` with its `operationId`.
  Mutations accept a stable `operationId` retained across retries (old clients
  receive an ID per attempt). Frozen migration returns 503 `draft_migration_pending`;
  migrated offline storage returns 503 `server_offline`, timeout 504 `fetch_timeout`.
  `storage_error`, `rename_in_progress` and `rename_pending` return 503: clients
  retain the mutation ID because an accepted operation may still recover. Payload
  mismatches (`operation_conflict`/`operation_mismatch`) return 409; validation stays 422.
  POST `/:draftId/blobs` accepts `{revision,operationId,hash,contentBase64}` without
  advancing revision; snapshot `binaryBaseline`/`binaryTree` contain `{hash,size}`
  references only. GET `/:draftId/blobs/:hash` returns private uncached bytes.
  HTTP attaches the current internal `projectId`; portable envelopes omit it.

- **Provider diagnostics (2026-09-11)**: assistant errors distinguish rejected requests (400/422), authentication/permissions (401/403), provider payment/quota (402 or explicit insufficient quota), missing model/endpoint (404), request size (413), rate limits (429), timeouts (408/504) and provider server errors (5xx). Context classification takes precedence only for explicit context rejections. Chat error events and logs carry a local correlation ID, HTTP status and exact-allowlisted provider code/parameter; never raw error text, bodies or headers. Legacy migration events preserve these categories; runner logs identify run/step. Generic `provider_error` remains for unclassified failures and legacy incomplete results.

- **Conversation uploads (2026-09-11)**: message `attachments` are validated string maps, merged by filename and stored independently of the transcript. Missing/empty maps preserve previous files. Background acceptance and upload persistence share a transaction; rejected/replayed requests do not change files. Reads recheck owner/Project access and network/server scope. Raw upload bodies are excluded from task metadata and read-tool transcript results; provider-generated text may quote sources. Invalid names/types or reserved `server:` IDs return `invalid_attachments`; limits return `attachment_too_large` / `attachments_too_large` (422), before provider execution. Uploads do not replace retained server references.

- **General assistant (2026-09-11)**: new background chat uses ordinary menu/dialog/command/translation tools; no `start_migration`, `get_migration` or `resume_migration` capability is offered. The model chooses source reads and operation order. Accepted task metadata retains validated server selections (not raw contents); an empty follow-up selection reuses same-scope references, or legacy manifest references when needed. Sources and permissions are checked again before model execution. `get_previous_results` reads prior same-scope proposals without applying them. When the draft fingerprint is unchanged, pending proposals are replayed into the working copy and carried into the new task for one explicit apply; otherwise the live draft wins. Transcript checkpoints are saved between iterations, and Stop closes unexecuted tool calls. Four-minute provider inactivity includes partial tool payload progress; no SDK retry is requested.

- **Background assistant tasks (2026-09-09)**: `modules/assistant/routes.ts` accepts `POST conversations/:id/messages` with `{background:true, requestId}` and returns **202 `{task}`** after preflight. A repeated identical request ID returns the same task; conflicting input or a second active task returns 409. Legacy requests retain SSE. `GET conversations/:id/tasks` and `GET .../tasks/:taskId` restore activity/results without execution; `POST .../tasks/:taskId/stop` is the explicit cancellation action. Reads/control recheck ownership, Project access and original network/server scope. Browser disconnects never cancel a task. An abandoned worker becomes `blocked` after 90 seconds without a heartbeat; no automatic paid restart occurs. Explicit legacy migration resume/compression reconnects its existing task journal and Stop signal; new chat work does not create a migration run.

- **Legacy migration context (2026-09-09)**: the API, not a local byte/token estimate, enforces context capacity. Legacy `contextTokens` is ignored for execution and new budgets store null. Agentic runs expose `canCompress` / `compressing`; private continuation data is never included. POST `/:runId/compress` requires `expectedRevision`, a paused context-full checkpoint, current access, unchanged source hashes, an available provider and credits. It explicitly authorizes summary generation followed by continuation under a lease. Reads never trigger compression. `/resume` returns `compression_required` while compression is needed. Successful summary/debit is checkpointed before continuation; failures retain state. Output, transfer and credit safeguards remain independent.

- **Legacy resumable migrations**: `modules/assistant/migration/routes.ts` owns `/api/v1/assistant/conversations/:id/migrations`: POST creates a metadata-only manifest with an idempotent `requestId`; GET lists runs, reads `/:runId`, `/events?after=&limit=`, `/proposals`. POST `/start`, `/pause`, `/resume`, `/cancel` requires `expectedRevision`. Every request rechecks conversation ownership, membership, live Project and stored network/server scope. Start/resume rereads source hashes and requires the exact active model/provider plus credits; absent runner returns 503 before transition. GET never starts paid work (it may recover expired leases). Raw source YAML is not persisted; derived proposals are not automatically published to disk.
- Migration model IDs are fixed without fallback; V1 uses active catalog pricing at each step, not a price snapshot. The accepted credit budget is checked between steps and may be exceeded by the in-flight provider call.
- Production start/resume dispatches `migration/runner.ts` independently of HTTP/SSE. Each lease-owned step rereads source hashes, uses at most three bounded calls (menu proposal or selected-source read), disables SDK retries, and checkpoints one validated reserved menu with usage/debit atomically. EOF without an explicit provider finish, truncated/oversized output, missing usage or validation failure pauses without a proposal; known failed usage is logged without debit. Pause is effective between steps, and loss of lease aborts the active call. Canonical and legacy click DSL links are checked against reserved targets; missing recognized links remain visible verification issues. A changed source needs a new POST analysis/request ID, not silent reuse of prior proposals.

- **Migration input (2026-09-08)**: creation no longer requires `maxCredits`; legacy caps are ignored and new runs store null. Context/output limits and network/per-turn credit safeguards remain. Malformed YAML, duplicate keys or unsafe-to-expand aliases fall back to bounded raw-source reading with a non-blocking `source_analysis_incomplete` warning; dependency extraction is skipped for that source, never invented. Generated menu validation is unchanged.

- **Assistant SSE transport**: heartbeat `event: heartbeat`, `data: {}` every 15 seconds while the turn is active. The editor discards these frames (including payload-only heartbeats); they do not accept or clear the composer. Timers stop on completion or disconnect, with at most one heartbeat write pending. `X-Accel-Buffering: no` requests unbuffered delivery but cannot override every proxy timeout.
- **Assistant diagnostics**: `X-Assistant-Request-Id` and error SSE `correlationId` identify a turn. Safe codes distinguish `provider_timeout`, `provider_network_error`, `provider_cancelled`, `provider_error`, `engine_error`; structured logs also report `client_disconnected` without raw provider errors or source contents. Disconnect never automatically retries a paid request or changes transcript/debit rules. The client does not read the correlation header; error frames carry it directly.

**Création de projet** (`POST /api/v1/networks/:id/projects`) : le nom saisi devient
le dossier du serveur (128 caractères maximum, sans traversée de chemin). Le backend
vérifie `project_list`, écrit `manifest.yaml` via `project_write` (`create: true`,
`base_hash: null`), puis crée l'ancre DB après confirmation du plugin. Réponses :
201 succès, 409 `project_exists`, 422 `invalid_name`, 503 `server_offline`,
504 `fetch_timeout`, 502 erreur de lecture/écriture. Aucun contenu n'est stocké en DB.

- Tout endpoint est sous **`/api/v1/`** (versioning : breaking change → `/api/v2/<name>` à côté, garder v1 6-12 mois).
- **Accounts-only** (depuis l'accounts-only cutover, cf. `docs/decisions/accounts-only-editing.md`) : un seul système d'auth — **user session** (cookie `artisan_user_session`, HttpOnly 30j → row `user_sessions.id`) → routes `networks/*`, `user/projects/*`, `auth/*`, `admin/*`. Les routes `admin/*` ajoutent `requireAdmin` après `userAuth` (403 si `!user.isAdmin`). La trust dance anonyme (server_key + `editor_session` token dans l'URL, routes `editor-session/:token/*`) a été supprimée (Task 7) — plus aucune route session-mode.
- Style d'erreur : `c.json({ error: "snake_case_reason" }, <status>)`.

## Index par fichier de routes

| Fichier | Surface |
|---|---|
| `auth.ts` | `auth/signup`, `auth/login`, `auth/logout`, `auth/me` (GET + PATCH `editor_language`), `auth/forgot-password` (POST **public** `{email}` → **toujours 204**, email inconnu compris — anti-énumération ; envoie `passwordResetEmail` fire-and-forget avec un lien `${EDITOR_URL}/reset-password?token=…` valable 1 h ; 400 `invalid_body`), `auth/reset-password` (POST **public** `{token,password}` → 204 ; 422 `weak_password` **avant** consommation du token — un refus laisse le lien réutilisable ; 400 `invalid_token` si inconnu/expiré/rejoué ; succès = nouveau hash + `destroyUserSessions` + invalidation des autres tokens). |
| `discordOauth.ts` | `auth/discord/configured`, `auth/discord/start`, `auth/discord/callback`. Uses `lib/discordOauth.ts` for provider calls and `lib/oauthAccounts.ts` for shared account resolution; new links require a verified email. |
| `googleOauth.ts` | `auth/google/configured`, `auth/google/start`, `auth/google/callback`. Button enabled only with client ID, secret and redirect URI. Signed flow cookie, state/nonce/PKCE, verified Google ID token, shared identity resolution. The optional `/start?next=…` local editor path is kept in the signed flow cookie. Success returns to that path (default `${EDITOR_URL}/account`); errors return to `${EDITOR_URL}/login?oauth_error=…`, preserving `next` after state validation. External destinations are rejected. |
| `link.ts` | `link/:code/redeem` (POST, **no auth** — le code = bearer single-use) + `link/:code` (GET status). Redeem par le plugin `/artisan link` (cf. flux ci-dessous). |
| `userNetworks.ts` | `networks` (CRUD + PATCH `:id` — name/slug, 409 `slug_taken`), `networks/:id` (GET détail — la liste des projects porte leur **identité** seule ; le compte de Documents se lisait dans la copie backend, qui n'existe plus), `networks/:id/server-keys` (create / PATCH `:keyId` — label/slug / `rotate` / DELETE / `status` / `helloes` / `allowlist`), `networks/:id/servers-status?current=<serverKeyId>` (GET — agrégat read-only pour le badge "serveurs liés" de la topbar : `{servers[{id,label,online,instanceCount,lastMcVersion,lastSeenAt,lastSeenIp,isCurrent}], online, total}`, `lastSeen*` = dernier hello **accepté**), `networks/:id/projects` (POST — **`serverKeyId` requis**), `networks/:networkId/servers/:serverId/modules` (GET — présence `{modules:[{id, version}]}`, cookie auth + membership ; 404 si le serveur n'appartient pas au network), `networks/:networkId/servers/:serverId/data-sources` (GET — présence `{data_sources:[{ref, module_id, schema, schema_hint}]}` ; `schema` est un tableau de `{name, type, description}`, `[]` si absent ; module_id et schema portent l'enrichissement signalé par le plugin au hello/modules_changed, absents sur plugins pré-schéma). `networks/:networkId/servers/:serverId/screens` (GET — présence `{screens:[{id, module_id, label, table, project_id}]}` triés par id, cookie auth + membership ; Config screens déclarés par les modules, ADR `module-config-screens` §2), `networks/:networkId/servers/:serverId/config/read` (POST — body `{project_id, table}` relayé au plugin connecté via `config_read`/`config_read_result`, timeout 5 s ; 200 `{files:[{path,content}]}`, 404 `unknown_project`, 422 `invalid_input`\|`invalid_path`, 502 `read_error`\|`too_large`, 503 `server_offline`, 504 `fetch_timeout`), `networks/:networkId/servers/:serverId/config/write` (POST — body `{project_id, files:[{path,content}], deletes?}` relayé via `config_write`/`config_write_result`, timeout 10 s ; le plugin écrit sur disque et hot-reload ; **plus de journalisation backend** — la révision du 2026-07-30 est tombée avec l'historique (ADR `server-disk-only-storage`) ; 200 `{ok:true}`, mêmes codes d'erreur que `config/read` avec `write_error`). `networks/:networkId/servers/:serverId/projects/:projectId/files` (GET — cookie auth + membership ; l'arbre complet d'un Project **lu à la demande sur le disque du serveur**, relayé via `project_read`/`project_read_result` (`requestProjectRead`, timeout 5 s). Le backend ne détient aucune copie du contenu (ADR `server-disk-only-storage`), donc `:projectId` est l'**id disque** — le seul que le Project possède ici — et un serveur hors ligne rend le Project simplement inouvrable : 503, jamais un repli périmé. 200 `{files:[{path,content}]}` trié, `.artisan/editor.yaml` inclus (l'éditeur en est propriétaire) mais corbeille et métadonnées de sync exclues ; 404 `unknown_project`, 422 `invalid_input`\|`invalid_path`, 502 `read_error`\|`too_large`, 503 `server_offline`, 504 `fetch_timeout`). `networks/:networkId/servers/:serverId/projects/:projectId/files` (PUT — cookie auth + membership ; écrit les fichiers du Project sur le disque du serveur via `project_write`/`project_write_result`, timeout 10 s. Body `{files:[{path,content,base_hash}], deletes?:[{path,base_hash}]}` ; `base_hash` est **obligatoire** (`null` = « pas de fichier ici quand j'ai chargé ») — sans lui un enregistrement écraserait le disque à l'aveugle, d'où 422. **409 `conflict`** avec `{conflicts:[{path,disk}]}` quand un fichier a bougé : le backend relaie verbatim, il n'arbitre jamais — il n'a aucune copie avec quoi arbitrer. 200 `{ok:true}`, 404 `unknown_project`, 422 `invalid_input`\|`invalid_path`, 502 `write_error`, 503 `server_offline`, 504 `fetch_timeout`). `networks/:networkId/servers/:serverId/projects/:projectId/history?path=…` (GET — cookie auth + membership ; les versions archivées d'un fichier via `project_history`, la plus récente d'abord ; 200 `{versions:[{at,content}]}`, liste vide si le fichier n'a jamais été écrasé. **Pas de route de restauration** : restaurer, c'est un PUT normal du contenu choisi, donc soumis au même compare-and-swap). `networks/:networkId/servers/:serverId/players` (GET — cookie auth + membership ; qui est connecté, relayé au plugin via `online_players_fetch`/`online_players_result` (`requestOnlinePlayers`, timeout 5 s) ; 200 `{players:[string]}` triés. **Jamais d'erreur** : serveur hors ligne, timeout ou échec plugin renvoient `{players:[]}` — les sélecteurs de joueur de l'éditeur retombent sur la saisie libre plutôt que de bloquer). `networks/:networkId/servers/:serverId/resource-pack/rebuild` (POST — délègue à `handleResourcePackRebuild` partagé avec `resourcePack.ts`). `networks/:networkId/servers/:serverId/data-sources/preview` (POST — cookie auth + membership ; body `{ref, params?, filter?, sort?, limit?, args?}` relayé au plugin connecté via `data_source_fetch`/`data_source_fetch_result` (`requestDataSourceFetch`, timeout 5 s) ; 200 `{rows, truncated}`, 404 `unknown_source`, 422 `invalid_input`\|`player_required`, 502 `fetch_error`, 503 `server_offline`, 504 `fetch_timeout`). Les `:id` réseau acceptent id **ou** slug. **Members & invites** (mutations et invites gérées par `requireCapability(..., "manage_members")`, cf. `lib/capabilities.ts` ; le GET roster est lisible par **tout membre** via `requireMember`) : `networks/:id/members` (GET — tout membre, join `users`, `{userId,email,displayName,role,createdAt}`), `networks/:id/members/:userId` (DELETE — 409 `last_owner` si la cible est le dernier membre `manage_members`-capable, un owner peut se retirer lui-même sinon ; PATCH `{role:"owner"\|"member"}` — 422 `invalid_role`, 409 `last_owner` sur démotion du dernier), `networks/:id/invites` (POST `{email?,maxUses?,expiresInDays?}` → `{invite:{id,code,url,email,maxUses,usedCount,expiresAt}}`, `url` = `${EDITOR_URL}/invite?code=…` ; GET — liste), `networks/:id/invites/:inviteId` (DELETE — `revokeInvite`, 404 si hors network). **Access requests** (`lib/accessRequestStorage.ts`) : `networks/:idOrSlug/access-requests` (POST — **tout user authentifié, PAS de membership requis** — c'est la porte d'entrée pour un non-membre ; `{message?}` cap 500 → 422 `invalid_message` ; 409 `already_member` si déjà membre, 409 `already_pending` si une request pending existe déjà pour `(user, network)` ; 404 network inconnu ; 201 `{request:{id,status}}` — envoie `accessRequestEmail` fire-and-forget à chaque membre `manage_members`-capable), `networks/:id/access-requests` (GET, `manage_members` — pending d'abord → `{requests:[{id,userId,email,displayName,message,status,createdAt}]}`), `networks/:id/access-requests/:requestId/approve`\|`/deny` (POST, `manage_members` → `{status}` ; `approve` appelle `addMembership(role:"member")`, tolère 23505 déjà-membre ; 404 hors network, 409 `not_pending` si déjà résolue). |
| `userProjects.ts` | `user/projects/:projectId` (GET / DELETE, user-auth + membership check). **GET ne renvoie que l'identité** — ID interne, ID de dossier, serveur propriétaire, network ; le contenu se lit sur le disque du serveur via `…/projects/:pid/files` (ADR `server-disk-only-storage`). Il n'y a plus de PUT : l'écriture passe par le disque. DELETE = soft-delete (`softDeleteProject`, la ligne reste en DB avec `deletedAt`) + `pushProjectDeleted`. `user/projects/:projectId/items` + `user/projects/:projectId/custom-items` (GET — bibliothèque de l'éditeur ; les items vanilla viennent des fichiers backend `data/items/*.json`, avec fallback sur le fichier le plus récent quand aucune version MC n'est connue : **la bibliothèque ne dépend pas d'un serveur en ligne**). `:projectId` se résout par ID de dossier/module dans `?network=<idOuSlug>&server=<idOuSlug>` (serveur), ou `?network=<idOuSlug>` (hébergé). Sans portée, il reste un ID interne. Les alias historiques non ambigus restent acceptés (`refs.ts`). `user/projects/:projectId/draft` (POST — broadcast `draft_update` aux autres connexions éditeur + au plugin via `broadcastDraftUpdate` ; transport en place, producteur client à venir — l'appel HTTP n'est lié à aucune session WS d'onglet, donc aucune exclusion d'émetteur n'est possible côté serveur). |
| `userAssets.ts` | `user/projects/:projectId/assets` (CRUD + `:id/duplicate`, user-auth + membership check via `getNetworkOfProject`/`requireMember`) — délègue à `handleAsset*` (`lib/assetHandlers.ts`), zéro duplication métier. Monté sur le même préfixe `/api/v1/user/projects` que `userProjectsRouter` (paths distincts, pas de collision). Erreurs `unauthorized`/`forbidden`/`not_found`. |
| `userWsTicket.ts` | `user/ws-ticket` (POST, cookie auth) → `{ ticket }` — ticket one-shot (TTL 30s, `wsTickets.ts`) redeemable une fois à l'upgrade `GET /ws/editor?ticket=…` (subscription au `Set<serverKeyId>` de tous les networks du user), cf. `docs/architecture/ws-protocol.md` § Auth du WS éditeur. |
| `networkTransfers.ts` | `networks/:id/transfer/init`, `networks/transfer/:token` (GET / `accept`). Transfert de propriété d'un Network (TTL 24h, clean break). |
| `invites.ts` | `invites/:code` (**public, sans auth** — GET → `{status, network_name, role}` via `inviteStatus`, 404 `not_found`), `invites/:code/accept` (POST, cookie user requis → 401 sans session ; `{network_id, already_member}` ; 410 `revoked`\|`expired`\|`exhausted`, 404 `not_found`). `acceptInvite` (`lib/inviteStorage.ts`) consomme l'invite atomiquement (`UPDATE … WHERE valid RETURNING`) pour éviter une race sur `maxUses` ; check-membre → consume → `addMembership` (catch 23505 = rollback du usedCount + `already_member`). Monté avant `userNetworksRouter`, `userAuth()` appliqué mais ne 401 jamais lui-même (GET reste public). |
| `serverKeys.ts` | Création server_key standalone (auto-crée un Network par défaut). |
| `textures.ts` / `textures.assets` | Sert PNG : vanilla (`textures/:version/*`), custom (`textures/custom/:sk/*`), asset (`textures/asset/:projectId/:assetName`), asset-font (`textures/asset-font/:projectId/:police/*`). Les deux dernières lisent **le disque du serveur** — plus de repli sur le volume backend (P6). |
| `models.ts` / `modelBundle.ts` | Sert JSON modèles : vanilla (`models/:version/*`), custom (`models/custom/:sk/*`). |
| `resourcePack.ts` | `resource-pack/:server_key_id/:hash.zip` — `Cache-Control: immutable`, `ETag`. IDs générés `srv_…` et UUID acceptés ; séparateurs de chemins refusés. 404 si hash inconnu. |
| `modules/assistant/routes.ts` | `assistant/conversations` (**GET** — liste les conversations d'un project via `?packId=`, titres + dates seulement ; **POST** — crée une conversation `{packId}`, renvoie `{conversationId}`), `assistant/conversations/:id` (GET — transcript complet pour la reprise), `assistant/conversations/:id/messages` (POST — **réponse SSE**, flux d'`EngineEvent` ; la working-copy est reconstruite depuis `menus`/`attachments` du body, le transcript est persisté après le stream). Conversations stockées en DB (`assistant_conversations`), scopées par `ownerKey` (`user:<userId>` uniquement, `resolveOwnerKey`). Auth **cookie `artisan_user_session`**. Monté via `assistantModule` (cf. `mountModules` dans `app.ts`). `POST /api/v1/assistant/conversations/:id/messages` — body accepte `modelId?` et `serverAttachments?: [{sourceId, paths}]` ; 402 `insufficient_credits` si solde network ≤ 0 ; événement SSE final `credits {debited, balance}` ; erreur provider = loggée non débitée. Les fichiers serveur sont lus en preflight via le plugin et fusionnés sous `server:<sourceId>/<path>` dans la working-copy éphémère. |
| `modules/assistant/adminRoutes.ts` | `admin/assistant-config` (GET — renvoie `{provider, baseUrl, model, keySet}`, **jamais la clé** ; PUT — upsert `{provider, baseUrl, model, apiKey?}` chiffré dans `app_settings`, renvoie `keySet`), `admin/assistant-config/test` (POST — teste un provider, renvoie `{ok}`). Auth **super-admin** (`userAuth` + `requireAdmin` sur `/api/v1/admin/*` dans `app.ts`). |
| `modules/ai/routes.ts` | `/api/v1/ai/models`, `/api/v1/ai/balance`, `/api/v1/ai/preferred-model` — Sélecteur user : modèles actifs + estimations, solde network (`ownerKey` = `user:<userId>`), modèle préféré. `/balance` renvoie `{ balance, total, subscription, rollover, topup }` (breakdown par bucket pour l'indicateur composer ; `balance` = `total`, conservé pour compat). Auth **cookie user-session uniquement**. |
| `modules/ai/adminRoutes.ts` | `admin/ai/models` (GET/POST/PUT), `admin/ai/models/:id/default` (PUT — marque défaut unique), `admin/ai/models/:id/test` (POST), `admin/ai/providers` (GET/PUT `[/:slug]`), `admin/ai/settings` (GET/PUT), `admin/ai/credits/grant` (POST), `admin/ai/usage/summary` (GET — totaux + marge, répartitions, série journalière), `admin/ai/usage/logs` (GET — filtrables + export CSV), `admin/ai/users/:userId` (GET — focus user) — Catalogue de modèles IA (CRUD + défaut unique + test live), credentials providers (write-only), settings credits, grant admin, analytics consommations. Auth **super-admin**. |
| `adminUsers.ts` | `admin/users` (GET — liste + recherche `?q=` sur nom/email, ilike ; expose `hasPassword`, **jamais `passwordHash`**), `admin/users/:id` (GET — profil + networks/rôles via `memberships`), `admin/users/:id` (PATCH — `name`/`email`/`isAdmin` ; email normalisé trim+lowercase, unique → 409 `email_taken`, 422 `invalid_email`/`invalid_name` ; un admin ne peut pas se retirer son propre flag → 422 `cannot_demote_self`). Auth **super-admin**. |
| `modules/billing/adminRoutes.ts` | `admin/billing/packs*`, `admin/billing/plans*` (CRUD admin des packs de credits + formules d'abonnement, provisionne les products/prices Stripe), `GET/PUT admin/billing/editor-policy` (quota gratuit, activation ; audit), `GET admin/billing/sales` (synthèse ventes : CA top-up par devise + abonnés actifs/formule + série journalière ; `?from&to`, 400 `invalid_range` si dates invalides, défaut = 30 derniers jours), `POST admin/billing/grant` (grant manuel de crédits `{networkId, amount, note?}` → bucket `topup` / reason `adjustment`, 400 `invalid_amount`, 404 `network_not_found`) |
| `modules/billing/userRoutes.ts` | `/api/v1/billing/checkout/{pack,subscription}`, `/api/v1/billing/portal`, `/api/v1/billing/{balance,packs,plans,editor-offer,subscription,purchases}` (`editor-offer` public ; le reste couvre Checkout, Customer Portal, soldes, catalogue et historique avec membership). Pour un Pro annuel, `balance.periodEnd` indique le prochain renouvellement mensuel des crédits, plafonné par la fin de l'année payée. |
| `modules/billing/webhookRoutes.ts` | `POST /api/v1/billing/webhook` (**public**, signature Stripe vérifiée, idempotent via `stripe_events`) : fulfillment top-up (`checkout.session.completed` → credits `topup` + `credit_purchases`) + cycle de vie abonnement (`invoice.paid` → grant 1re période / renouvellement plafonné ; `invoice.payment_failed` → grâce ; `customer.subscription.updated/deleted` → `status`/`networks.tier`). Réseau résolu par `metadata.networkId`. Monté **avant** `userAuth()` dans `app.ts`. |

## Flux non-évidents

- **Copie hébergée → Minecraft** (routeur retiré 2026-09-27, ADR `server-only-projects` ; le lib reste jusqu'au retrait du stockage hébergé) : `projectCopies.ts`, sous `/api/v1/user/projects/:projectId`. `GET /copy-targets` renvoie `{sourceRevision,targets}` avec serveurs connectés autorisés, version exacte, compatibilité modules et dossier libre proposé. `POST /copies` reçoit `{operationId,targetServerKeyId,folderName,sourceRevision}` ; réponse directe `{operationId,state,sourceRevision,targetServerKeyId,targetNetworkId,folderName,projectId,error}`. `GET /copies/:operationId` relit l'état ; `POST /copies/:operationId/resume` reprend les octets figés. `202 pending` conserve l'intention hors ligne ; `200 completed` fournit l'ancre destination ; `409 failed` ou erreur préliminaire explicite. Lecture source + droits `publish_content`/`edit_content` cible sont revérifiés avant chaque message de mutation. Aucune publication de brouillon implicite ; une révision source modifiée avant capture renvoie `source_revision_changed`. Les reçus sont privés à l'acteur et ne transportent jamais les octets du transfert.

- **HeadDatabase previews** : `userNetworks.ts`, `GET /api/v1/networks/:networkId/servers/:serverId/head-texture?id=<numeric-id>`, cookie auth + network membership (ids or slugs). Relays to the selected plugin and returns `{texture}`; offline/old plugin times out gracefully in the editor. No backend catalog or persisted Project content.

- **Promotion** : `promote/:dst` est **fast-forward only** → `409 not_fast_forward` si divergence. Le merge 3-way / résolution de conflits a été retiré le 2026-06-17 (jamais câblé en UI ; concurrence live gérée par LWW + présence) — cf. ADR `no-branch-conflict-resolution`.
- **Link editor-first** (cf. ADR `editor-first-server-linking`) : l'éditeur crée le Server via `POST /networks/:id/server-keys` (clé **non-redeemée**, `hash` NULL, aucun secret) qui renvoie `{id, code, expires_at}` ; re-link via `POST /networks/:id/server-keys/:keyId/link-code` (mint un code pour une clé existante). Le plugin `/artisan link <code>` appelle `POST /link/:code/redeem` (**no auth**, code = bearer single-use) → `redeemLinkCode` génère le secret, pose le `hash` (rotation si déjà redeemée), marque le code consommé, renvoie `{server_key, network_name}` **une fois**. Erreurs : `404 not_found`, `409 already_redeemed`, `410 expired`. L'ancien flux WS pairing (`setup_request`/`setup_claim`) + `POST /link` + `claim` ont été supprimés le 2026-07-15.
- **Le backend ne stocke aucun contenu de Project** : les routes `/api/v1/bundles` et `…/branches` ont disparu avec lui. La protection contre l'écrasement concurrent est le compare-and-swap par fichier de `PUT …/projects/:pid/files` (cf. `invariants.md`).
- **DELETE project** (`user/projects/:projectId`) : soft-delete (`deletedAt`) + broadcast `project_deleted`.
- **Verrou optimiste des saves éditeur (2026-07-06)** : le PUT de contenu (`user/projects/:projectId`) porte la version chargée (`baseVersion`) et échoue en `409 version_conflict` (+ version courante) si un autre writer a écrit entre-temps ; le GET de chargement renvoie `version`. Exception : le PUT en **auto-create** (project inexistant) ne demande pas de précondition. Détail : `entities.md` § Concurrence optimiste.
- **Custom items** : `user/projects/:projectId/custom-items` lit le **cache disque** (`data/custom-items/{sk}/{hash.txt,items.json,textures/}`), peuplé par le plugin via WS `custom_items_bundle`. `items: []` si pas encore synchronisé.
- **Resource pack multi-project** : `rebuildResourcePack(serverKeyId)` collecte les assets de tous les projects du server_key **sur leur disque** et merge les codepoints (`lib/rpCodepointMerger.ts`). Un Project illisible interrompt la reconstruction et laisse le pack précédent en place — mieux vaut un pack en retard qu'un pack amputé.
- **server_key security** : `rotate` invalide l'ancien hash et drop l'auth des conns vivantes (re-hello requis) ; `allowlist` (IP) rejette au hello suivant + log dans `helloes`.
- **Config IA admin (DB→env)** : `admin/assistant-config` stocke la config provider dans `app_settings["assistant"]` (`StoredAssistantConfig`, clé API chiffrée AES-256-GCM via `secretBox`). Le moteur (`assistant/routes.ts` → `resolve()`) lit via `loadAssistantProviderConfig()` : **config DB déchiffrée si présente & utilisable** (model + (clé ou base locale), `CONFIG_ENC_KEY` requis), sinon fallback `resolveProviderConfig(env)`. Une modif admin prend donc effet **sans redeploy**. La clé en clair n'est **jamais** renvoyée : GET expose `keySet: boolean` ; PUT avec `apiKey` vide **préserve** la clé stockée (l'admin peut changer model/provider sans re-saisir la clé) ; PUT renvoie `503 encryption_not_configured` si on tente d'écrire une clé sans `CONFIG_ENC_KEY`. `/test` n'inclut jamais la clé dans son erreur.
- **Sources d'import serveur de l'assistant** (`userNetworks.ts`) : `GET networks/:networkId/servers/:serverId/projects/:projectId/import-sources` exige la session user, l'appartenance au Network et la relation exacte Network → Server → Project. Le backend relaie `import_sources_list` au plugin sans lire ni persister le contenu et renvoie `{sources:[{id,label,files:[{path,size}],error?}]}` après validation stricte de toute la réponse ; le seul `error` public par source est `too_many_entries`. Erreurs : 401 sans session, 403 hors Network, 404 si le Server ou le Project ne correspond pas au contexte, 502 `read_error` sur erreur plugin ou réponse malformée (**le message brut du plugin n'est jamais exposé**), 503 `server_offline`, 504 `fetch_timeout`.
- **Pièces jointes serveur d'un tour assistant** : `serverAttachments` ne transporte que les références choisies (maximum 32 sources, 200 fichiers au total ; `sourceId` ≤ 128 caractères, chemin ≤ 1024). Après les contrôles conversation + Project, le backend exige une réponse atomique à `import_sources_read` avant de construire la working-copy, modifier le transcript, ouvrir le SSE, résoudre le modèle ou consulter/débiter les crédits. Un échec ne lance donc aucun tour et ne facture rien : 404 `unknown_source`\|`not_found`, 422 `invalid_input`\|`invalid_path`\|`unsupported_file`\|`too_many_files`\|`file_too_large`\|`too_large`\|`invalid_utf8`, 502 `read_error` (inclut erreur plugin inconnue, réponse malformée ou `ok` non booléen), 503 `server_offline`, 504 `fetch_timeout`. La réponse REST n'expose jamais le `message` fourni par le plugin. Le payload brut de la source est disponible au modèle pendant `runTurn`, mais le backend n'en crée ni cache, ni table, ni copie persistante : seul le résultat brut `read_attachment` correspondant aux ids `server:<sourceId>/<path>` de ce tour est remplacé par un marqueur non sensible avant la sauvegarde du transcript ; les autres résultats de tools restent intacts. Si le provider échoue pendant un tel tour, `ai_usage_log.error_message` stocke le code stable `server_attachment_provider_error`, jamais le détail provider susceptible de réinclure le payload. Cette garantie ne filtre pas les réponses ou artefacts dérivés que le modèle produit : ils suivent la persistance normale de la conversation ou du Project.
- **Assistant IA (SSE)** : `POST assistant/conversations` crée une conversation persistée en DB (`assistant_conversations`) scopée à `ownerKey` (`user:<userId>`) ; elle est seedée avec le system prompt (`buildSystemPrompt`) + une working-copy des `menus`/`attachments` fournis. `POST assistant/conversations/:id/messages` (404 si conversation inconnue ou `ownerKey` différent) optionnellement re-seede la working-copy (`menus` dans le body), pousse le message user, puis stream les `EngineEvent` de `runTurn` en **SSE** (`event:` = type d'event : `text`/`tool`/`menu_written`/`menu_deleted`/`usage`/`error`/`done`, `data:` = JSON de l'event). `503` si aucun provider n'est configuré (`ASSISTANT_API_KEY` absent et base non-locale).

- **Lecture des pièces jointes avant réponse** : `runTurn` exige un `read_attachment` réussi pour chaque fichier local ou serveur du tour courant. Tant que ces résultats n'ont pas été vus par le modèle, le texte est masqué et les outils d'écriture sont rejetés (y compris dans le batch demandant la lecture). Une réponse prématurée déclenche un seul rappel éphémère demandant les lectures restantes en parallèle ; une nouvelle réponse prématurée ou le plafond de 25 itérations produit `error {code: "attachments_not_read", readCount, totalCount, message}` puis `done {stopReason: "attachments_not_read"}`. Les usages des appels effectués restent comptabilisés. Ce contrôle garantit la lecture, pas la compréhension du contenu.

## Accès commercial à l'éditeur

Lecture de fichiers, serveur déconnecté (2026-09-26) : `GET …/files` répond 200 avec la dernière copie du miroir et `offlineSince` (aussi sur `unchanged`) ; `GET /networks/:id/servers/:sid/projects` et le détail du réseau listent les Projects qui ont une copie, avec `offline: true`. `routes/projectContent.ts` expose les **Versions** (2026-09-26) : `GET /api/v1/projects/:projectId/versions` → `{versions:[{id,hash,createdAt,author,changed}]}` (50 plus récentes), `GET …/versions/:versionId` → `{id,hash,createdAt,files,binaries}` (404 inconnue). `GET …/history?path=` sert l'historique d'un fichier depuis les Versions (`author` inclus), et retombe sur la corbeille du plugin tant qu'aucune Version n'existe. Il expose aussi `GET /api/v1/projects/:projectId/editor-access` (session et appartenance requises). La réponse indique quota, compteur personnel live, origine du Project, échéance Pro et raison éventuelle ; inventaire indisponible = 503. Les écritures de `projectContent.ts`, `projectDrafts.ts` et `userNetworks.ts` propagent `quota_denied` (403), `inventory_unavailable` et `plugin_update_required` (503). `modules/billing/editorAccess.ts` résout la politique du Network et du serveur.

## Endpoints supprimés (ne pas réintroduire)

- `…/networks/:id/hosted-projects` (+ `/templates`), `…/user/projects/:projectId/copy-targets|copies*`, `POST /api/v1/demo/claim` — retirés 2026-09-27 (ADR `server-only-projects`).
- `POST /api/v1/networks/:id/projects` sur un Server non relié ou hors ligne ne renvoie plus 503 : il crée le Project `unpublished` avec un brouillon du créateur (`manifest.yaml`), 409 si le dossier existe déjà en base.

Guest draft `ownerId` equals the bootstrap principal ID. Account-only copy middleware is scoped to `copy-targets` and `copies` paths so adjacent guest asset routes retain principal authorization.

- `…/projects/:projectId/bindings/*` (GET/PATCH/POST/DELETE) — modèle `project_bindings` M:N supprimé 2026-06-03 (→ 1:N `projects.serverKeyId`). Cf. `entities.md`.
