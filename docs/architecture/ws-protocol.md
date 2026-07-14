# WS Protocol — plugin ↔ backend

> Référence du protocole WebSocket entre le plugin Kotlin et le backend.
> Source de vérité du code : `backend/src/ws/hub.ts`, `editor/src/lib/ws/pluginBridge.ts`, plugin `WsClient.kt`.
> Quand tu modifies un message, mets à jour ce fichier (cf. tableau de discipline docs dans `CLAUDE.md`).

## Versioning / forward-compat

`hello` carries `protocol_version: "1"` + `core_version`. Unknown message types are logged + ignored (forward-compat). Tout endpoint REST associé est sous `/api/v1/`.

## Messages

| Message | Sens | Contenu clé |
|---|---|---|
| `hello` | plugin → backend | `server_key`, `current_bundle_hash`, `local_project_ids?: string[]` — ids des projects présents sur le disque du plugin ; le backend crée un stub vide (`createProject`) pour chacun qu'il ne connaît pas encore (cf. `hello_ack` ci-dessous), `custom_items_hash?`, `installed_modules?: {id, version}[]` — modules enregistrés dans le `ModuleRegistry` au moment de la connexion ; le backend persiste par server_key (`server_modules`), l'éditeur lit pour gater la visibilité des modules (activation par présence, spec 2026-06-15 §8). Absent sur anciens plugins. `data_sources?: {ref, module_id?, schema?: {name, type, description}[], schema_hint?}[]` — data sources enregistrées dans le `DataSourceRegistry` au moment de l'envoi. Alimente le source picker de l'éditeur. `module_id`/`schema` absents sur plugins pré-schéma (legacy `schema_hint` seulement). Absent/vide sur les vieux plugins. |
| `modules_changed` | plugin → backend | `{ type, server_key, installed_modules: {id, version}[], data_sources: {ref, module_id?, schema?: {name, type, description}[], schema_hint?}[] }` — émis quand un module se `register()`-e après l'envoi du `hello` (ex: plugin tiers `onEnable`). Le backend re-exécute `persistServerModules` pour la même session. `data_sources` : data sources enregistrées dans le `DataSourceRegistry` au moment de l'envoi. Alimente le source picker de l'éditeur. `module_id`/`schema` absents sur plugins pré-schéma (legacy `schema_hint` seulement). Absent/vide sur les vieux plugins. |
| `hello_ack` | backend → plugin | `project_hashes`, `needs_sync`, `api_url`, `editor_url: string` — `EDITOR_URL` env, URL browser-facing de l'éditeur, purement informative (affichée par `/artisan editor`), `server_url: string` — deep link vers la page de ce serveur dans l'éditeur (`${EDITOR_URL}/networks/${netRow.slug ?? netRow.id}/servers/${skRow.slug ?? skRow.id}` ; fallback plain `EDITOR_URL` si le `server_key`/network est introuvable). Le plugin (`SyncedMenuProvider.handleMessage`) préfère `server_url`, avec fallback sur `editor_url` pour un backend plus vieux qui ne l'enverrait pas encore. C'est cette valeur que `/artisan editor` affiche via `MenuProvider.editorInfo()`, `network_name: string` — nom du network du `server_key` (résolu via `serverKeys.networkId → networks.name`), `resource_pack: { url, hash } \| null`, `deleted_project_ids: string[]` — liste des projects supprimés côté éditeur depuis la dernière connexion, pour que le plugin puisse move-to-trash les projects locaux correspondants. **Phase 2** : `project_hashes[projectId]` = `branch.head_commit.contentHash` (branche `"main"` en V1 ; le project est résolu via `projects.serverKeyId`). Contenu vide → `""` (sentinel, cohérent avec `BundleHasher`/`computeBundleHash`) : un stub fraîchement créé pour un `local_project_ids` inconnu est annoncé dans le **même** `hello_ack` avec `""`, ce qui déclenche l'auto-push du plugin (`backendHash.isEmpty()` → `local_push`) dès la première connexion, au lieu d'écraser le contenu local. |
| `bundle_available` | backend → plugin | `project_id`, `url`, `hash` |
| `draft_update` | backend → plugin | `menu_id`, `menu_yaml` — transport en place (`POST /api/v1/user/projects/:projectId/draft` → `broadcastDraftUpdate`), producteur client à venir |
| `ping` / `pong` | backend ↔ plugin | keepalive OkHttp 30s |
| `resource_pack_updated` | backend → plugin | `{ url, hash }` — broadcast après chaque rebuild |
| `custom_items_changed` | plugin → backend | `{ hash }` — hot-reload Nexo/Oraxen/ItemsAdder |
| `custom_items_request` | backend → plugin | `{}` — demande le bundle complet |
| `custom_items_bundle` | plugin → backend | `{ hash, data }` — `data = base64(gzip(zip))` |
| `project_divergence_detected` | plugin → backend | `{ project_id, disk_files, disk_hash, last_synced_hash }` — **Plan 1C: handler is now a no-op for backward compat; new plugins log WARN instead** |
| `project_deleted` | backend → plugin | `{ project_id }` — project supprimé côté éditeur, le plugin move-to-trash |
| `local_push` | plugin → backend | `{ project_id, files, hash }` — used by `/artisan pushLocal`. Backend creates project if missing (avec `serverKeyId` de la session), upserts content, broadcasts `bundle_available`. Si le project backend est un stub jamais édité (`isEmptyStub`), le backend construit aussi `editorJson` via `importProjectFromFiles` (les dossiers module inconnus deviennent `moduleData[<dir>].__files`). Un `editorJson` réel n'est jamais écrasé. |

## Auth du WS éditeur (`GET /ws/editor`)

Accounts-only : un seul chemin d'authentification, ticket one-shot (le chemin `?token=` de la trust dance anonyme a été supprimé en Task 7 — cf. `docs/decisions/accounts-only-editing.md`) :

| Chemin | Query param | Auth | Abonnement |
|---|---|---|---|
| Ticket one-shot (user) | `?ticket=` | ticket minté via `POST /api/v1/user/ws-ticket` (cookie auth), consommé une fois à l'upgrade (`wsTickets.redeemTicket`) | l'ensemble des `serverKeyId` sur tous les networks du user (memberships → networks → server_keys, `listServerKeyIdsForUser`) |

Le ticket (`backend/src/lib/wsTickets.ts`) est en mémoire (Map), one-shot (supprimé au premier `redeemTicket`, même si expiré), TTL 30 s — cohérent avec la posture single-instance actuelle (cf. audit prod-readiness). `?ticket=` invalide/inconnu/expiré → 401 avant l'upgrade.

Côté hub (`hub.ts`), une conn éditeur porte un `Set<serverKeyId>` (`editorTokenToServers`) — l'ensemble des serveurs du user. `broadcastDraftUpdate`, `pushModuleEvent`, `pushProjectDeleted` délivrent à toute conn dont le set contient le `serverKeyId` visé.

Côté éditeur (`editor/src/lib/editorWs.ts`), `EditorWs.connectAsUser(apiUrl, onDraftUpdate)` fetch un ticket frais (`credentials: "include"`) puis ouvre `?ticket=`. Reconnexion = ré-appeler `connectAsUser` (le ticket est one-shot, pas réutilisable).

## Flux de données (orientation)

```
[Editor browser]
   │ WS ws://backend:3001/ws/plugin  (pluginBridge.ts)
   │ POST /api/v1/bundles/:projectId (bundlePublisher.ts)
   ▼
[Backend Bun/Hono]
   │ WS /ws/plugin                   (hub.ts)
   │ REST /api/v1/bundles, /api/v1/server-keys, ...
   ▼
[Plugin Kotlin]
   │ hello → hello_ack + bundle_available
   │ GET /api/v1/bundles/:projectId  (BundleDownloader.kt)
   └ écrit sur disque → hot-reload menus
```

## Invariants liés (détaillés dans `CLAUDE.md` § Invariants critiques)

- **Plus de freeze de conflit** : `pushBundleAvailable` (`hub.ts`) broadcast sans condition (`project_conflicts` n'existe plus). La protection contre l'écrasement concurrent est le verrou optimiste `baseVersion`/`409 version_conflict` sur `PUT /api/v1/user/projects/:projectId`.
- **Hash byte-order** : `BundleHasher.kt` / `hashUtils.ts` trient par ordre byte natif — jamais `localeCompare`.
- **OkHttp thread** : `SyncedMenuProvider.handleMessage` tourne sur le callback WS d'OkHttp — pas d'I/O bloquant direct.
