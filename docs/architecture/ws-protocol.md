# WS Protocol — plugin ↔ backend

> Référence du protocole WebSocket entre le plugin Kotlin et le backend.
> Source de vérité du code : `backend/src/ws/hub.ts`, `editor/src/lib/ws/pluginBridge.ts`, plugin `WsClient.kt`.
> Quand tu modifies un message, mets à jour ce fichier (cf. `.claude/skills/sync-docs/doc-impact-map.yaml`).

## Versioning / forward-compat

`hello` carries `protocol_version: "1"` + `core_version`. Unknown message types are logged + ignored (forward-compat). Tout endpoint REST associé est sous `/api/v1/`.

## Messages

| Message | Sens | Contenu clé |
|---|---|---|
| `hello` | plugin → backend | `server_key`, `current_bundle_hash`, `local_project_ids?: string[]` — ids des projects présents sur le disque du plugin ; le backend crée un stub vide (`createProject`) pour chacun qu'il ne connaît pas encore (cf. `hello_ack` ci-dessous), `custom_items_hash?`, `installed_modules?: {id, version}[]` — modules enregistrés dans le `ModuleRegistry` au moment de la connexion ; le backend persiste par server_key (`server_modules`), l'éditeur lit pour gater la visibilité des modules (activation par présence, spec 2026-06-15 §8). Absent sur anciens plugins. `data_sources?: {ref, module_id?, schema?: {name, type, description}[], schema_hint?, stability?: "static" | "dynamic", key_field?}[]` — data sources enregistrées dans le `DataSourceRegistry` au moment de l'envoi. Alimente le source picker de l'éditeur. `stability`/`key_field` (2026-07-15) : axe statique/dynamique **déclaré** par le module — `static` = jeu de Row keys énumérable (place-able en **mode placement** de menu, `key_field` = champ clé de ligne) ; `dynamic`/absent par défaut (legacy). `module_id`/`schema` absents sur plugins pré-schéma (legacy `schema_hint` seulement). Absent/vide sur les vieux plugins. |
| `modules_changed` | plugin → backend | `{ type, server_key, installed_modules: {id, version}[], data_sources: {ref, module_id?, schema?: {name, type, description}[], schema_hint?, stability?: "static" | "dynamic", key_field?}[] }` — émis quand un module se `register()`-e après l'envoi du `hello` (ex: plugin tiers `onEnable`). Le backend re-exécute `persistServerModules` pour la même session. `data_sources` : data sources enregistrées dans le `DataSourceRegistry` au moment de l'envoi. Alimente le source picker de l'éditeur. `stability`/`key_field` (2026-07-15) : axe statique/dynamique **déclaré** par le module — `static` = jeu de Row keys énumérable (place-able en **mode placement** de menu, `key_field` = champ clé de ligne) ; `dynamic`/absent par défaut (legacy). `module_id`/`schema` absents sur plugins pré-schéma (legacy `schema_hint` seulement). Absent/vide sur les vieux plugins. |
| `hello_ack` | backend → plugin | `api_url`, `editor_url: string` — `EDITOR_URL` env, URL browser-facing de l'éditeur, purement informative (affichée par `/artisan editor`), `server_url: string` — deep link vers la page de ce serveur dans l'éditeur (`${EDITOR_URL}/networks/${netRow.slug ?? netRow.id}/servers/${skRow.slug ?? skRow.id}` ; fallback plain `EDITOR_URL` si le `server_key`/network est introuvable). Le plugin préfère `server_url`, avec fallback sur `editor_url`. `network_name: string` — nom du network du `server_key`. `resource_pack: { url, hash } \| null`. **Plus de `project_hashes` / `needs_sync` / `latest_bundle_hash` / `deleted_project_ids`** : le backend ne détient plus de contenu, il n'a donc rien à comparer ni à annoncer (ADR `server-disk-only-storage`). Les `local_project_ids` du `hello` restent utiles — un project présent sur le disque et inconnu du backend y est enregistré, **identité seulement**. |
| `draft_update` | backend → plugin | `menu_id`, `menu_yaml` — transport en place (`POST /api/v1/user/projects/:projectId/draft` → `broadcastDraftUpdate`), producteur client à venir |
| `ping` / `pong` | backend ↔ plugin | keepalive OkHttp 30s |
| `resource_pack_updated` | backend → plugin | `{ url, hash }` — broadcast après chaque rebuild |
| `custom_items_changed` | plugin → backend | `{ hash }` — hot-reload Nexo/Oraxen/ItemsAdder |
| `custom_items_request` | backend → plugin | `{}` — demande le bundle complet |
| `custom_items_bundle` | plugin → backend | `{ hash, data }` — `data = base64(gzip(zip))` |
| `declared_models` (champ de `hello` / `modules_changed`) | plugin → backend | Documents `model/v1` déclarés par les modules (`api.models.declare`), verbatim (id namespacé, `version` + `migrations` déclaratives). Persistés dans `server_declared_models` (upsert + prune, miroir `data_sources`), servis à l'éditeur via `GET …/servers/:sid/models` (ADR composable-data-models §4). |
| `project_deleted` | backend → plugin | `{ project_id }` — project supprimé côté éditeur, le plugin move-to-trash |
| `data_source_fetch` | backend → plugin | `{type, request_id, ref, params, filter, sort, limit, args}` — preview request relayed from `POST …/data-sources/preview`. Corrélé par `request_id`, timeout 5 s côté backend (couvre les vieux plugins qui ignorent le type). `args` = valeurs d'essai pour l'interpolation `{arg}`. |
| `data_source_fetch_result` | plugin → backend | `{type, request_id, ok, rows?, truncated?, error?, message?}` — réponse du plugin (fetch `player = null` sur le main thread + shaping `ContextBinder`, rows tronquées à 50 / ≤ 256 KB). `error` ∈ `unknown_source` / `player_required` / `fetch_error`. |
| `editor_screens` (champ de `hello` / `modules_changed`) | plugin → backend | Config screens déclarés par les modules (`api.screens.declare`), verbatim : `{id (namespacé), module_id, label, table, project_id}`. Persistés dans `server_editor_screens` (upsert + prune, miroir `declared_models`), servis à l'éditeur via `GET …/servers/:sid/screens` (ADR `module-config-screens` §2). Purement déclaratif — rien n'est interprété plugin-side. |
| `project_read` | backend → plugin | `{type, request_id, project_id}` — l'arbre complet d'un Project lu sur le disque du serveur, relayé depuis `GET …/servers/:sid/projects/:pid/files` (ADR `server-disk-only-storage`, P0). Corrélé par `request_id`, timeout 5 s. Généralise `config_read`, qui ne portait qu'une Table. |
| `project_read_result` | plugin → backend | `{type, request_id, ok, files?, error?, message?}` — `files = [{path, content}]` en chemins relatifs triés, plafond 8 MiB cumulés (mesuré : les vrais projects font 8 à 43 Ko, deux ordres de grandeur de marge → pas de découpage). `.artisan/editor.yaml` **inclus** (l'éditeur en est propriétaire), `.artisan/history/`, `.artisan-trash/` et `.artisan-sync.yaml` exclus. `error` ∈ `invalid_path` / `unknown_project` / `too_large` / `read_error`. |
| `project_write` | backend → plugin | `{type, request_id, project_id, files:[{path, content, base_hash}], deletes?:[{path, base_hash}]}` — l'éditeur écrit les fichiers du serveur (ADR `server-disk-only-storage`, P1), relayé depuis `PUT …/servers/:sid/projects/:pid/files`, timeout 10 s. `base_hash` = SHA-256 du contenu chargé par l'éditeur ; `null` = « je m'attends à ce qu'il n'y ait pas de fichier ici ». Chemins autorisés = tout sauf corbeille et métadonnées de sync — `.artisan/editor.yaml` **est** écrivable (l'éditeur en est propriétaire). |
| `project_write_result` | plugin → backend | `{type, request_id, ok, conflicts?, error?, message?}` — **tout ou rien** : un seul `base_hash` périmé annule l'écriture entière et remonte `error: "conflict"` avec `conflicts = [{path, disk}]`, `disk` étant le contenu actuel (`null` = supprimé sur disque) pour que l'éditeur affiche le diff sans second aller-retour. Avant tout écrasement ou suppression, l'ancien contenu part dans `.artisan/history/<rel>/<ms>` (anneau de 20, cf. décision 5). `error` ∈ `invalid_path` / `unknown_project` / `conflict` / `write_error`. |
| `project_history` | backend → plugin | `{type, request_id, project_id, path}` — les versions archivées d'**un** fichier (corbeille `.artisan/history/`, ADR `server-disk-only-storage` décision 5), relayé depuis `GET …/projects/:pid/history?path=…`. Corrélé, timeout 5 s. |
| `project_history_result` | plugin → backend | `{type, request_id, ok, versions?, error?, message?}` — `versions = [{at, content}]`, **la plus récente d'abord**. Un fichier jamais écrasé rend une liste vide, pas une erreur. **Restaurer n'a pas de message dédié** : c'est un `project_write` normal du contenu choisi, donc soumis au même compare-and-swap. `error` ∈ `invalid_path` / `unknown_project` / `read_error`. |
| `config_read` | backend → plugin | `{type, request_id, project_id, table}` — lecture live des fichiers d'une Table de Config screen, relayée depuis `POST …/config/read`. Corrélé par `request_id`, timeout 5 s. |
| `config_read_result` | plugin → backend | `{type, request_id, ok, files?, error?, message?}` — `files = [{path, content}]` lus sur disque (cap 1 MiB cumulés). `error` ∈ `invalid_path` / `unknown_project` / `too_large` / `read_error`. |
| `config_write` | backend → plugin | `{type, request_id, project_id, files, deletes?}` — écriture live depuis `POST …/config/write` (ADR `module-config-screens` §3 : le backend **relaie sans stocker**). Timeout 10 s. |
| `config_write_result` | plugin → backend | `{type, request_id, ok, error?, message?}` — le plugin écrit les fichiers et hot-reload. Rien n'est journalisé côté backend : la révision du 2026-07-30 (« une racine gérée est une racine versionnée ») est tombée avec l'historique, le disque étant désormais la seule vérité. `error` ∈ `invalid_path` / `unknown_project` / `write_error`. |
| `player_inventory_fetch` | backend → plugin | `{type, request_id, player}` — snapshot de l'inventaire d'un joueur en ligne, relayé depuis `GET …/player-inventory?player=X` (panneau de capture, ADR `captured-items-and-module-field-kit`). Corrélé par `request_id`, timeout 5 s. |
| `player_inventory_result` | plugin → backend | `{type, request_id, ok, slots?, error?, message?}` — slots non-vides (0-35 storage, 36-39 armure, 40 offhand) : `{slot, stack_yaml (ItemStack Bukkit sérialisé, clé racine "item:"), display {material?, head_texture?, enchanted?, count?, name?}}` — descripteur dérivé génériquement des composants vanilla, `material` enrichi en ref custom (`nexo:<id>`) si reconnu. `error` ∈ `player_not_found` / `fetch_error`. |
| `online_players_fetch` | backend → plugin | `{type, request_id}` — qui est connecté, relayé depuis `GET …/players`. Alimente les sélecteurs de joueur de l'éditeur (panneau de capture, « Prévisualiser en tant que » du canvas) pour qu'un admin choisisse dans une liste au lieu de taper un pseudo à l'aveugle. Corrélé par `request_id`, timeout 5 s. |
| `online_players_result` | plugin → backend | `{type, request_id, ok, players?, error?, message?}` — noms tels que le serveur les connaît, triés (casse ignorée). Serveur hors ligne ou timeout → la route répond une liste vide, jamais une erreur : le sélecteur retombe sur la saisie libre. |

## Auth du WS éditeur (`GET /ws/editor`)

Accounts-only : un seul chemin d'authentification, ticket one-shot (le chemin `?token=` de la trust dance anonyme a été supprimé en Task 7 — cf. `docs/decisions/accounts-only-editing.md`) :

| Chemin | Query param | Auth | Abonnement |
|---|---|---|---|
| Ticket one-shot (user) | `?ticket=` | ticket minté via `POST /api/v1/user/ws-ticket` (cookie auth), consommé une fois à l'upgrade (`wsTickets.redeemTicket`) | l'ensemble des `serverKeyId` sur tous les networks du user (memberships → networks → server_keys, `listServerKeyIdsForUser`) |

Le ticket (`backend/src/lib/wsTickets.ts`) est en mémoire (Map), one-shot (supprimé au premier `redeemTicket`, même si expiré), TTL 30 s — cohérent avec la posture single-instance actuelle (cf. audit prod-readiness). `?ticket=` invalide/inconnu/expiré → 401 avant l'upgrade.

Côté hub (`hub.ts`), une conn éditeur porte un `Set<serverKeyId>` (`editorTokenToServers`) — l'ensemble des serveurs du user. `broadcastDraftUpdate`, `pushModuleEvent`, `pushProjectDeleted` délivrent à toute conn dont le set contient le `serverKeyId` visé.

Côté éditeur (`editor/src/lib/editorWs.ts`), `EditorWs.connectAsUser(apiUrl, onDraftUpdate)` fetch un ticket frais (`credentials: "include"`) puis ouvre `?ticket=`. Reconnexion = ré-appeler `connectAsUser` (le ticket est one-shot, pas réutilisable).

## Flux de données (orientation)

Le contenu ne transite plus par le backend : il vit sur le disque du serveur, et
le backend n'est qu'un **relais** (ADR `server-disk-only-storage`).

```
[Editor browser]
   │ GET  /api/v1/networks/:n/servers/:s/projects/:p/files   (lecture)
   │ PUT  /api/v1/networks/:n/servers/:s/projects/:p/files   (écriture, sur geste)
   ▼
[Backend Bun/Hono]           ← relaie, ne stocke aucun contenu
   │ WS /ws/plugin  (hub.ts) : project_read / project_write
   ▼
[Plugin Kotlin]              ← SEUL écrivain
   │ lit l'arbre disque · CAS par fichier · corbeille .artisan/history/
   └ écrit sur disque → hot-reload menus
```

## Invariants liés (détaillés dans `invariants.md`)

- **Un seul écrivain** : le plugin. Le backend relaie et n'arbitre jamais — il n'a aucune copie avec quoi arbitrer. La protection contre l'écrasement concurrent est le **compare-and-swap par fichier** de `project_write` (tout ou rien, conflits rendus avec le contenu disque).
- **Le hash n'est plus inter-langage** : `BundleHasher` ne sert qu'au plugin (détection de changement + jeton de CAS). Le vecteur de conformance partagé a disparu avec l'implémentation backend.
- **OkHttp thread** : `SyncedMenuProvider.handleMessage` tourne sur le callback WS d'OkHttp — pas d'I/O bloquant direct.
