# WS Protocol — plugin ↔ backend

`papi_placeholders_fetch {request_id}` requests the connected server's current
PlaceholderAPI catalog. `papi_placeholders_result` echoes `{request_id,ok,
placeholders?:[{placeholder,expansion}],truncated?,error?:"fetch_error"}`.
Only registered expansions' explicit lists are used, normalized to `%id_params%`;
empty/broken expansions contribute no suggestions. Collection runs on the Bukkit
main thread. Limits: 2,000 entries, 256 characters per token, 128 KiB of names.
The backend binds replies to the exact requested authenticated connection,
releases pending requests on disconnect, and times out old plugins after 5 s.

## Console membership

`hello.editor_access_mode` is `invitation` (default, including legacy/unknown
values) or `console`, persisted on the authenticated server key. The plugin
reads `editor.access_mode` at startup/reload. Console/RCON-only
`artisan member add <email>` sends `member_add {request_id,email}` on that
connection. `member_add_result` echoes `request_id` with `ok`, optional
`already_member`, or `error` (`unauthorized`, `console_disabled`, `invalid_email`,
`account_not_found`). No caller-supplied network or role is accepted: the backend
adds an existing account as `member` to the key's network, preserving existing
roles. Missing/replaced connections cannot grant access; replies time out after
15 seconds in the plugin. Repeating the command is idempotent.

## Hosted-to-server copies (`project_copy_v1`)

`hello.capabilities` negotiates `project_copy_v1`. `project_copy` carries
`request_id`, stable `operation_id`, `target_id`, `fingerprint` and `action`:
`begin` adds `minecraft_version`, sorted `modules` IDs and sorted `files`
descriptors `{path,size,sha256}`; `chunk` adds `path`, byte `offset` and
`content_base64`; `commit` verifies and activates; `status` queries the durable receipt.
The fingerprint is SHA-256 of UTF-8 compact JSON in exact property order
`{target_id,minecraft_version,modules,files}`, with descriptor order `path,size,sha256`.
`project_copy_result` echoes correlation, operation, folder and fingerprint plus
`ok`, `state: missing|staging|activated`, optional `error`, and the complete
`file_hashes` map on activation. Backend accepts only the requesting authenticated connection.

Bounds: 5,000 files, 16 MiB per file, 64 MiB total, 192 KiB decoded chunks,
eight pending operations per server. Manifest is mandatory; exact Minecraft
version and required module IDs are checked. Public `.artisan/editor.yaml` is
included; private drafts/history, unsafe paths and duplicate case-folded paths are excluded.
Plugin stages outside discovered roots, verifies every size/digest before one activation,
and keeps receipts for idempotent recovery after lost ACK. Staging expires after
24 hours without effective writes; status polling does not renew it. Expired
operations return `operation_expired` and require a new operation ID. Activated roots never expire.
Windows syncs file contents and atomically renames; directory fsync is unavailable,
so abrupt power-loss guarantees follow the existing filesystem publication boundary.

Backend reserves the folder before sending and suppresses hello/list discovery
until the exact activation receipt is verified. Reconnect/pong maintenance resumes
authorized operations; revoked actors permit only status reconciliation, never upload.
After the destination anchor commits, resource-pack rebuild/push runs and retries
from a durable `resource_pack_pending` flag if needed.

## Atomic mixed publication (2026-09-13)

The `hello` capability `project_mixed_write_v1` enables `project_write` with
`operation_id` and `binaries: [{path, content_base64, base_hash}]` alongside text
files, deletes and renames. All text/binary CAS checks precede one recoverable
publisher journal and one reload; duplicate or private paths are rejected.
The same operation ID replays its receipt after a lost acknowledgement without
overwriting later edits. Older plugins retain text writes; mixed writes return
`plugin_update_required` without sending a partial alternative.
Hosted project operations do not use this WebSocket channel.

> Référence du protocole WebSocket entre le plugin Kotlin et le backend.
> Source de vérité du code : `backend/src/ws/hub.ts`, `editor/src/lib/ws/pluginBridge.ts`, plugin `WsClient.kt`.
> Quand tu modifies un message, mets à jour ce fichier (cf. `.claude/skills/sync-docs/doc-impact-map.yaml`).

## Versioning / forward-compat

### Private drafts (`project_drafts_v1`, 2026-09-13)

Negotiated in `hello.capabilities`. `project_draft_request` carries `request_id`,
`project_id`, backend-verified `owner_id`, `action`; replies use
`project_draft_result` with `{ok,error?,draft?,drafts?,wrote?,content_base64?}`.
Correlation is bound to the exact authenticated plugin connection.
Actions: `list/read/create/update/discard/publish/write_blob/read_blob`;
backend-only migration actions: `import/list_all/purge_owner`.
**Depuis 2026-09-26** (ADR `snapshot-mirror-and-backend-history`), le backend ne s'en sert
plus que pour rapatrier les brouillons encore sur disque (`list_all`, `read_blob`) et purger
ceux des comptes supprimés (`purge_owner`) ; les brouillons vivent dans `project_drafts`.
Mutations carry `operation_id`; existing draft changes carry `expected_revision`.
`create/update` carry `draft_id,name,snapshot`; `import` carries the full `draft`.
The `artisan-draft/v1` envelope has no project ID and preserves owner, revision,
status, source, timestamps, baseline/tree/initialTree and renames. Binary snapshot
maps `binaryBaseline/binaryTree` use `{hash,size}`; `write_blob` transports
`hash,content_base64` separately without advancing revision. Publication finalizes
files and terminal draft state on storage, with a recoverable journal.
The plugin sends the durable publication receipt before reloading runtime menus
and commands. Reload continues under the project mutation lock and announces
`projects_reloaded`; a slow/failed reload cannot withhold an already committed
receipt. Backend draft RPCs time out after 30 seconds; the editor allows 45 seconds
to receive that structured outcome and retains the same operation ID on timeout.
Structurally impossible target hierarchies are rejected before the commit intent.
Completed publisher journals move atomically into `.artisan/transactions/.receipts/`
after their durable completion marker. Recovery scans only pending journals;
legacy completed journals are archived on their first recovery pass. Duplicate
operation IDs still read their retained receipt, and owner revocation scrubs
both pending journals and archived receipts. `project_list` returns identities
from the loaded snapshot without triggering disk discovery or recovery.
`storage_error` is an uncertain outcome; retry the same `operation_id` after recovery.
Legacy draft IDs retain their exact envelope spelling; uppercase-bearing IDs and
Windows device names use an encoded private directory on every OS, preserving
case-distinct IDs when projects move between filesystems.
`list_all` accepts an empty administrative owner and returns every unrevoked state.
`purge_owner` persists a private revocation marker, blocking restored owner data.
`hello_ack.bundle_url` carries `BUNDLE_BASE_URL` (fallback `API_BASE_URL`) for
plugin-side resource-pack downloads; `resource_pack.url` remains player-facing.
Resource-pack refresh skips an old database project only when the plugin confirms
`unknown_project`; a timeout/offline project still preserves the previous pack.
Ordinary reads/exports/runtime never include `.artisan/drafts/`.

`hello` carries `protocol_version: "1"` + `core_version`. Unknown message types are logged + ignored (forward-compat). Tout endpoint REST associé est sous `/api/v1/`.

**Version de contenu (`content_version`, ADR `content-version-negotiation`, 2026-10-01).** `hello.content_version?: number` = version du **format de contenu de projet** que le plugin sait lire. Absente = `1` (ancien wire DSL) ; `2` = étapes structurées keyed (ADR `structured-action-wire`). Le backend suit la version par connexion, l'expose via `GET /networks/:id/servers-status` (`contentVersion`), et **refuse les écritures de contenu** (`project_write`, publication `project_draft_request`) sous `MIN_CONTENT_VERSION` (= 2) avec l'erreur `plugin_update_required` — on ne produit jamais de fichiers qu'un plugin en retard ne saurait pas lire. L'éditeur affiche « plugin obsolète » pour ce serveur.

## Messages

### Project identity and durable rename (2026-09-12)

`hello.capabilities` negotiates `project_rename`. `project_roots` reports
`{project_id, identity: "folder" | "addon"}` on hello, list, reload and module
registration. Add-on IDs remain registered and immutable; folder roots can rename.
`project_rename` carries `request_id`, durable `operation_id`, `project_id` and
`target_project_id`; `project_rename_result` echoes them with `ok` and `error`.
The backend reserves the target and blocks text/config/binary writes while pending.
The plugin journals the filesystem operation; hello `project_rename_results`
replays successful receipts before discovery. Lost replies retry with the same
operation ID in the background; listings exclude reserved source/target roots
and return `pending_renames`, while unrelated projects stay available.
SQL keeps the immutable Project primary key.
`rename_error` remains pending; definite rejection releases the reservation.
On server-initiated WebSocket close, the client acknowledges `onClosing` so
`onClosed` schedules reconnection (including replacement close code 1012).
Hello reads a cached immutable identity snapshot from the last completed reload
or mutation; the OkHttp callback neither scans the disk nor waits on root locks.
Authenticated receipts must match the operation's server and both identities.
`project_renamed` notifies editors with `server_key_id`, immutable `project_id`,
`previous_disk_id` and `disk_id`; tree caches are invalidated for both names.
Explicit `identity_migrations: [{from: "boutique_shop", to: "boutique_addon"}]`
requires a registered `boutique_addon` root. Occupied destinations stop migration;
drafts and other foreign keys retain their anchor. Retired folder IDs are reserved
by the plugin against stale creates until a future generation-aware create API.

| Message | Sens | Contenu clé |
|---|---|---|
| `hello` | plugin → backend | `server_key`, `current_bundle_hash`, `local_project_ids?: string[]` — ids des projects présents sur le disque du plugin ; le backend crée un stub vide (`createProject`) pour chacun qu'il ne connaît pas encore (cf. `hello_ack` ci-dessous), `custom_items_hash?`, `installed_modules?: {id, version}[]` — modules enregistrés dans le `ModuleRegistry` au moment de la connexion ; le backend persiste par server_key (`server_modules`), l'éditeur lit pour gater la visibilité des modules (activation par présence, spec 2026-06-15 §8). Absent sur anciens plugins. `data_sources?: {ref, module_id?, schema?: {name, type, description}[], schema_hint?, stability?: "static" | "dynamic", key_field?}[]` — data sources enregistrées dans le `DataSourceRegistry` au moment de l'envoi. Alimente le source picker de l'éditeur. `stability`/`key_field` (2026-07-15) : axe statique/dynamique **déclaré** par le module — `static` = jeu de Row keys énumérable (place-able en **mode placement** de menu, `key_field` = champ clé de ligne) ; `dynamic`/absent par défaut (legacy). `module_id`/`schema` absents sur plugins pré-schéma (legacy `schema_hint` seulement). Absent/vide sur les vieux plugins. `snapshot_hashes?: {id, hash}[]` (capacité `snapshot_mirror_v1`, 2026-09-26) — empreinte du Snapshot de chaque Project, la même que `project_read_result.hash` : le backend s'en sert pour savoir si son miroir est encore valide (cf. § Miroir du Snapshot). |
| `modules_changed` | plugin → backend | `{ type, server_key, installed_modules: {id, version}[], data_sources: {ref, module_id?, schema?: {name, type, description}[], schema_hint?, stability?: "static" | "dynamic", key_field?}[] }` — émis quand un module se `register()`-e après l'envoi du `hello` (ex: plugin tiers `onEnable`). Le backend re-exécute `persistServerModules` pour la même session. `data_sources` : data sources enregistrées dans le `DataSourceRegistry` au moment de l'envoi. Alimente le source picker de l'éditeur. `stability`/`key_field` (2026-07-15) : axe statique/dynamique **déclaré** par le module — `static` = jeu de Row keys énumérable (place-able en **mode placement** de menu, `key_field` = champ clé de ligne) ; `dynamic`/absent par défaut (legacy). `module_id`/`schema` absents sur plugins pré-schéma (legacy `schema_hint` seulement). Absent/vide sur les vieux plugins. |
| `hello_ack` | backend → plugin | `api_url`, `editor_url: string` — `EDITOR_URL` env, URL browser-facing de l'éditeur, purement informative (affichée par `/artisan editor`), `server_url: string` — deep link vers la page de ce serveur dans l'éditeur (`${EDITOR_URL}/networks/${netRow.slug ?? netRow.id}/servers/${skRow.slug ?? skRow.id}` ; fallback plain `EDITOR_URL` si le `server_key`/network est introuvable). Le plugin préfère `server_url`, avec fallback sur `editor_url`. `network_name: string` — nom du network du `server_key`. `resource_pack: { url, hash } \| null`. **Plus de `project_hashes` / `needs_sync` / `latest_bundle_hash` / `deleted_project_ids`** : le backend ne détient plus de contenu, il n'a donc rien à comparer ni à annoncer (ADR `server-disk-only-storage`). Les `local_project_ids` du `hello` restent utiles — un project présent sur le disque et inconnu du backend y est enregistré, **identité seulement**. |
| `draft_update` | backend → plugin | `menu_id`, `menu_yaml` — transport en place (`POST /api/v1/user/projects/:projectId/draft` → `broadcastDraftUpdate`), producteur client à venir |
| `ping` / `pong` | backend ↔ plugin | keepalive OkHttp 30s |
| `resource_pack_updated` | backend → plugin | `{ url, hash }` — broadcast après chaque rebuild (écriture d'asset, copie de Project, et tout `projects_reloaded` — donc chaque publication de brouillon — **seulement si le hash a changé**). En mode délégation, c'est ce message qui écrit le zip et lance `delegate-reload-command` |
| `custom_items_changed` | plugin → backend | `{ hash }` — hot-reload Nexo/Oraxen/ItemsAdder |
| `custom_items_request` | backend → plugin | `{}` — demande le bundle complet |
| `custom_items_bundle` | plugin → backend | `{ hash, data }` — `data = base64(gzip(zip))` |
| `declared_models` (champ de `hello` / `modules_changed`) | plugin → backend | Documents `model/v1` déclarés par les modules (`api.models.declare`), verbatim (id namespacé, `version` + `migrations` déclaratives). Persistés dans `server_declared_models` (upsert + prune, miroir `data_sources`), servis à l'éditeur via `GET …/servers/:sid/models` (ADR composable-data-models §4). |
| `session_replaced` | backend → plugin | `{type, reason}` — un autre serveur vient de se connecter avec **cette** clé ; celui-ci est évincé du relais. Un seul WARN côté plugin, aucun retry : personne ne regarde la console au moment où ça tombe, mais tout le monde la lit après coup. |
| `project_deleted` | backend → plugin | `{ project_id }` — project supprimé côté éditeur, le plugin move-to-trash |
| `data_source_fetch` | backend → plugin | `{type, request_id, ref, params, filter, sort, limit, args}` — preview request relayed from `POST …/data-sources/preview`. Corrélé par `request_id`, timeout 5 s côté backend (couvre les vieux plugins qui ignorent le type). `args` = valeurs d'essai pour l'interpolation `{arg}`. |
| `data_source_fetch_result` | plugin → backend | `{type, request_id, ok, rows?, truncated?, error?, message?}` — réponse du plugin (fetch `player = null` sur le main thread + shaping `ContextBinder`, rows tronquées à 50 / ≤ 256 KB). `error` ∈ `unknown_source` / `player_required` / `fetch_error`. |
| `import_sources_list` | backend → plugin | `{type, request_id}` — demande les métadonnées des racines d'import read-only configurées par l'administrateur pour l'assistant. Corrélé par `request_id`, timeout 5 s côté backend ; un ancien plugin qui ignore ce type aboutit donc à `timeout`, sans fallback implicite. |
| `import_sources_list_result` | plugin → backend | `{type, request_id, ok, sources?:[{id,label,files:[{path,size}],error?}], error?, message?}` — chemins relatifs et tailles seulement, jamais le contenu. Le parcours se fait hors callback OkHttp ; une source dépassant 5 000 fichiers autorisés renvoie `error: "too_many_entries"` avec une liste vide, jamais un listing partiel. |
| `import_sources_read` | backend → plugin | `{type, request_id, selections:[{source_id,paths:string[]}]} ` — lecture à la demande des fichiers sélectionnés, corrélée avec un timeout de 10 s. Le plugin revalide les sources et chemins au moment de la lecture ; les racines restent strictement read-only. Un ancien plugin qui ignore ce type aboutit à `timeout`. |
| `import_sources_read_result` | plugin → backend | `{type, request_id, ok, files?:[{source_id,path,content}], error?, message?}` — contenu texte UTF-8 uniquement, réponse atomique (aucun fichier si l'un échoue). Limites : 200 fichiers, 1 MiB par fichier, 8 MiB cumulés. `error` ∈ `invalid_input` / `unknown_source` / `invalid_path` / `unsupported_file` / `not_found` / `too_many_files` / `file_too_large` / `too_large` / `invalid_utf8` / `read_error`. |
| `editor_screens` (champ de `hello` / `modules_changed`) | plugin → backend | Config screens déclarés par les modules (`api.screens.declare`), verbatim : `{id (namespacé), module_id, label, table, project_id}`. Persistés dans `server_editor_screens` (upsert + prune, miroir `declared_models`), servis à l'éditeur via `GET …/servers/:sid/screens` (ADR `module-config-screens` §2). Purement déclaratif — rien n'est interprété plugin-side. |
| `project_read` | backend → plugin | `{type, request_id, project_id, if_hash?}` — l'arbre complet d'un Project lu sur le disque du serveur, relayé depuis `GET …/servers/:sid/projects/:pid/files` (ADR `server-disk-only-storage`, P0). Corrélé par `request_id`, timeout 5 s. Généralise `config_read`, qui ne portait qu'une Table. |
| `projects_reloaded` | plugin → backend, puis backend → éditeurs | `{type, projects:[{id, hash}]}` — le plugin vient de relire ses Projects (`/artisan reload`, ou une de ses propres écritures). Une édition faite à la main sur le disque ne compte QU'à ce moment-là : sans cette annonce, l'éditeur garderait sa dernière version connue jusqu'à ce que quelqu'un pense à actualiser. Le backend oublie ce qu'il savait de ces arbres et relaie aux éditeurs du serveur, en ajoutant `server_key_id`, puis reconstruit le resource pack en arrière-plan (cf. `resource_pack_updated`). L'empreinte voyage avec : qui l'a déjà n'a rien à refaire. Pour un plugin `snapshot_mirror_v1`, elle devient aussi le hash annoncé du miroir, qui se remplit en arrière-plan. |
| `project_read_result` | plugin → backend | `{type, request_id, ok, hash?, unchanged?, files?, error?, message?}` — `files = [{path, content}]` en chemins relatifs triés, plafond 8 MiB cumulés (mesuré : les vrais projects font 8 à 43 Ko, deux ordres de grandeur de marge → pas de découpage). `.artisan/editor.yaml` **inclus** (l'éditeur en est propriétaire), `.artisan/history/`, `.artisan-trash/` et `.artisan-sync.yaml` exclus. `error` ∈ `invalid_path` / `unknown_project` / `too_large` / `read_error`. **`hash`** est l'empreinte de l'instantané (texte + binaires annoncés + documents en échec) : l'appelant la conserve et la rend en `if_hash` à la visite suivante ; si elle correspond, la réponse est `{ok, unchanged: true, hash}` et **rien n'est transporté**. Elle est calculée par le plugin SEUL et lui est simplement rendue — aucune convention inter-langage à tenir. |
| `project_write` | backend → plugin | `{type, request_id, project_id, files:[{path, content, base_hash}], deletes?:[{path, base_hash}], renames?:[{from, to, base_hash}], create?}` — `renames` = **déplacements** déclarés par l'éditeur : l'arbre seul ne distingue pas un renommage d'un « supprimer + créer », donc sans cette intention la corbeille archive une suppression qui n'en est pas une et l'historique du fichier devient orphelin. Appliqués **avant** les écritures (on peut renommer et modifier dans le même enregistrement) ; même CAS que le reste, et une destination déjà occupée est un conflit. — l'éditeur écrit les fichiers du serveur (ADR `server-disk-only-storage`, P1), relayé depuis `PUT …/servers/:sid/projects/:pid/files`, timeout 10 s. `base_hash` = SHA-256 du contenu chargé par l'éditeur ; `null` = « je m'attends à ce qu'il n'y ait pas de fichier ici ». Chemins autorisés = tout sauf corbeille et métadonnées de sync — `.artisan/editor.yaml` **est** écrivable (l'éditeur en est propriétaire). |
| `project_write_result` | plugin → backend | `{type, request_id, ok, conflicts?, error?, message?}` — **tout ou rien** : un seul `base_hash` périmé annule l'écriture entière et remonte `error: "conflict"` avec `conflicts = [{path, disk}]`, `disk` étant le contenu actuel (`null` = supprimé sur disque) pour que l'éditeur affiche le diff sans second aller-retour. La réponse porte aussi `disk_files` — l'état **réel** du dossier : un renommage fait à la main ressemble à une suppression, et sans cette liste « garder ma version » recrée l'ancien fichier à côté du nouveau. Avant tout écrasement ou suppression, l'ancien contenu part dans `.artisan/history/<rel>/<ms>` (anneau de 20, cf. décision 5). `error` ∈ `invalid_path` / `unknown_project` / `conflict` / `write_error`. |
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
| `plugin_update` | backend → plugin | `{type, request_id}` — envoyé seulement si le `hello` annonce la capacité `plugin_update_v1` (un vieux plugin ne reçoit jamais la demande). Relayé depuis `POST …/servers/:sid/plugin-update`, timeout 120 s. Le message ne porte **rien** : le plugin lit lui-même `GET /api/v1/plugin-release` puis télécharge `/artisan.jar` (Bearer server key). |
| `plugin_update_result` | plugin → backend | `{type, request_id, ok, version?, error?}` — le JAR est posé dans `plugins/update/<nom du JAR courant>`, Paper l'applique au prochain démarrage. Rien n'est écrit avant d'avoir vérifié la signature Ed25519 de `artisan-plugin
<version>
<sha256>` avec la clé publique embarquée, ni pour une version qui n'est pas strictement plus récente (`1.0.<build>`, dev = 0). `error` ∈ `no_release` / `not_newer` / `invalid_signature` / `download_failed` / `write_failed`. Jusqu'au `hello` suivant, le backend retient la version installée (`pluginUpdatePending` de `servers-status`). `hello.plugin_version` porte la vraie version du JAR depuis 2026-10-05 (avant : `"1.0.0"` en dur). |

## HeadDatabase previews

## Quota des ressources personnelles

Le `hello` annonce `resource_quota_v2` pour accepter un quota effectif nullable. `project_list_result.resource_inventory` rapporte les fichiers YAML de `menus/`, `dialogs/` et `commands/`, avec `project_id`, `path` et `origin` (`personal` ou `module`). Le scan lit le disque, même si un YAML est invalide ; une lecture incomplète renvoie une erreur. Le backend relaie `commercial_policy: {enabled: true, quota, pro_until: null}` dans les mutations soumises au quota (`project_write`, `asset_write`, `config_write`, publication `project_draft_request`). `quota` est la limite effective de la version payée, ou Free après expiration ; `null` signifie illimité, `0` aucune allocation. Le plugin accepte uniquement un entier positif ou nul ≤ 2147483647, ou le null explicite, et ne réinterprète plus Pro en quota fixe. Champ absent, chaîne ou nombre fractionnaire sont invalides.

Un quota fini reste compatible avec `resource_quota_v1` grâce à `pro_until: null`. Une limite illimitée exige v2 sur toutes les connexions d'écriture actives du serveur ; sinon `plugin_update_required` (503), sans envoi ambigu. Le plugin revérifie l'inventaire dans son exécuteur sérialisé avant publication atomique. `quota_denied` interdit l'opération entière ; `inventory_unavailable` échoue fermé. Les anciennes versions sans capacité sont refusées pour ces mutations ; l’application des limites du plan est permanente et ne dépend plus d’un interrupteur global.

Les racines enregistrées par les modules sont exemptées. Au-dessus du quota, seule la suppression explicite d'une ressource personnelle est admise ; le runtime, la lecture et les fichiers sur disque restent accessibles. Le quota est par serveur et indépendant du nom de l'offre : le catalogue standard fixe Free à 10 et Pro à 250 ressources personnelles ; une offre custom peut porter une autre limite ou être illimitée.

`head_texture_fetch` (backend → plugin) carries `{type, request_id, id}`; `id` is a numeric HDB id (1–10 digits). The plugin resolves the ItemStack on the Bukkit main thread and extracts its `textures` profile property through `ItemDescriptor`. `head_texture_result` replies `{type, request_id, ok, texture?, error?}` with Base64 texture data (≤16 KiB); errors are `hdb_unavailable`, `head_not_found`, `invalid_input`, or `fetch_error`. The backend accepts the correlated response only from the requested server, with a 5 s timeout for offline/old plugins. No protocol version bump: this is an additive optional preview exchange.

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

- Account deletion revokes outstanding editor tickets and closes live editor sockets belonging to that User (1008). Server keys removed with an unmanaged network are disconnected locally after commit. No `project_deleted` or file-write message is sent to Minecraft.

- **Une clé serveur = UN serveur vivant** : au `hello`, le backend évince la connexion précédente liée à la même clé (dernier arrivé gagne). Le relais choisit « la première connexion trouvée » — avec N instances sur une clé, chacune ayant son propre disque, on lirait l'une et écrirait l'autre, puis on basculerait en silence quand la première tombe.
- **Un seul écrivain** : le plugin. Le backend relaie et n'arbitre jamais — il n'a aucune copie avec quoi arbitrer. La protection contre l'écrasement concurrent est le **compare-and-swap par fichier** de `project_write` (tout ou rien, conflits rendus avec le contenu disque).
- **Snapshot hash partagé** : `BundleHasher.snapshotHash` et `hashUtils.computeProjectSnapshotHash` suivent le vecteur `testdata/project-snapshot-hash-conformance.json` pour les stockages serveur et hébergé.
- **OkHttp thread** : `SyncedMenuProvider.handleMessage` tourne sur le callback WS d'OkHttp — pas d'I/O bloquant direct.

## Miroir du Snapshot (2026-09-26)

ADR `snapshot-mirror-and-backend-history`. Pour un plugin qui annonce `snapshot_mirror_v1`,
le backend garde le dernier Snapshot de chaque Project (`project_snapshots` + `snapshot_blobs`)
et le sert **sans aller-retour** tant que son hash égale le dernier hash annoncé.

- **Hash annoncé** (mémoire, `lib/snapshotMirror.ts`) : fixé par `hello.snapshot_hashes`,
  mis à jour par `projects_reloaded` et par chaque lecture via le plugin ; effacé à la
  déconnexion du dernier plugin de la clé, par `disconnectServerKey`, et par un `hello` sans
  la capacité. Toute écriture relayée (`project_write`, `asset_write`, `config_write`,
  publication de brouillon, renommage, copie) le rend **inconnu** et périme les lectures en
  vol (compteur de génération).
- **Lecture** (`lib/projectTreeReads.ts`, seul point de passage : éditeur, assets, resource
  pack) : miroir au bon hash → servi ; sinon `project_read` avec `if_hash` = hash du miroir,
  `unchanged` le confirme, un arbre complet le remplace. `if_hash` de l'éditeur se tranche
  côté backend.
- **Remplissage** : après le `hello` (une fois les identités enregistrées) et à chaque
  `projects_reloaded`, en file séquentielle par serveur.
- **Liste des Projects** (`GET …/servers/:sid/projects`) : `listProjectsFromSnapshot` rend
  les ids du dernier `hello`/`projects_reloaded`, sans `project_list`. `resource_inventory`
  (quota) reste un scan disque en direct via `project_list`.
- **Ancien plugin** : chemin d'avant inchangé (fusion des lectures en vol + cache 5 s).
- **Serveur déconnecté** : la lecture rend la dernière copie avec `offline_since` (date de réception), sans plugin ; la liste des Projects (`listProjectsForEditor`) rend ceux qui ont une copie, marqués `offline`. Sans copie : hors ligne comme avant.
- **Versions** : chaque Snapshot rangé qui diffère du précédent crée une Version ; `project_history` ne sert plus que de repli pour un Project sans Version, et le plugin n'alimente plus `.artisan/history/`.
