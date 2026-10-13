# Protocole WS — hub ↔ serveur

> Le protocole entre le hub (serveur web de l'éditeur, module `plugin/hub`) et les serveurs
> Minecraft qu'il atteint. Source de vérité : `plugin/core/…/protocol/EditorRequest.kt` (messages
> entrants), `plugin/paper/…/ws/WsClient.kt` (client d'une feuille), `plugin/hub/…/PluginChannel.kt`
> et `RemoteServer.kt` (côté hub). Quand tu modifies un message, mets à jour ce fichier.

Depuis la phase F (2026-10), il n'y a plus de backend : le protocole hérité du relais
backend ↔ plugin est parlé par le hub. Le **même** jeu de messages sert deux transports :

| Transport | Quand | Classe |
|---|---|---|
| En process | Le serveur qui héberge le hub (serveur seul, ou hub d'un réseau) | `LocalServerLink` (`core`) : le message passe aux gestionnaires du WebSocket, la réponse revient par `deliver`, timeout 10 s. |
| WebSocket `/ws/plugin` | Une feuille du réseau (`web.role: leaf`) | `WsClient` côté feuille, `PluginChannel` + `RemoteServer` côté hub, timeout 30 s par requête. |

Le hub n'interprète aucun contenu : chaque route REST de l'éditeur devient un message du
protocole (`project_read`, `project_write`, `project_draft_request`…) passé par `ServerLink`
(`core`) aux gestionnaires existants (cf. `rest-endpoints.md`).

## Connexion d'une feuille

Une feuille se connecte à `web.hub-url` (ex. `ws://10.0.0.5:8765/ws/plugin`) et envoie `hello`.
Reconnexion avec backoff exponentiel (1 s → 60 s) ; ping OkHttp toutes les 30 s.

**`hello`** (feuille → hub). Champs envoyés par `WsClient` et lus par le hub :

| Champ | Lu par le hub pour |
|---|---|
| `protocol_version` | `ProtocolVersion.CURRENT` (`"1.1"`). Majeure différente de celle du hub : serveur listé `updateRequired`, plus rien ne lui est envoyé (503 `plugin_update_required`). Mineure inférieure à 1 : pas de `project_create`/`_delete`/`_rename` (501 `plugin_update_required`). |
| `server_key` | Le **secret du réseau** (nom de champ hérité). Comparé en temps constant ; faux ou vide : fermeture 1008. |
| `proxy_name` | Nom du serveur dans le réseau (`web.name`, sinon le nom du dossier du serveur). `[A-Za-z0-9_-]{1,64}`, jamais `local`. Identité du serveur et préfixe de ses Projects (`<serveur>.<dossier>`). |
| `plugin_version`, `minecraft_version` | Affichés dans la liste des serveurs ; la version Minecraft choisit le catalogue d'items. |
| `installed_modules` | `[{id, version}]` : présence des modules (`GET …/modules`). |
| `data_sources` | `[{ref, module_id?, schema?, schema_hint?, stability?, key_field?}]` (`DataSourceReport`). |
| `declared_models` | Documents `model/v1` déclarés par les modules, verbatim. |
| `editor_screens` | Écrans de config déclarés : `{id, module_id, label, table, project_id}`. |
| `server_config` | `config.yml` éditable en clés pointées (jamais `environment.yml`). |

`RemoteServer` lit aussi `custom_items_hash` s'il est présent (ancien `hello`) ; `WsClient` ne
l'envoie plus, l'empreinte suit par `custom_items_changed`.

**`hello_ack`** (hub → feuille) : `{session_id, server_id, editor_url, network_name,
resource_pack}`. `resource_pack` vaut le dernier pack que le hub a servi à ce serveur
(`{url, hash}`), ou `{}` : un objet sans adresse laisse au serveur le pack qu'il a déjà
(`PackUpdate.Incomplete`), `null` le lui retirerait. Avant `hello_ack`, `WsClient.request`
répond `null` sans rien envoyer.

**`session_replaced`** (hub → feuille) : un autre serveur s'est connecté avec le même nom ;
l'ancienne connexion est fermée (dernier arrivé gagne, cf. `invariants.md`).

## Messages

Toute requête porte un `request_id` ; la réponse le reprend, avec le type `<requête>_result`
(sauf mention) et `{ok, error?, message?}`. Un type inconnu ou un champ obligatoire manquant :
le message est ignoré (`EditorRequest.parse` rend `null`).

### Hub → serveur (requêtes de l'éditeur)

| Message | Réponse | Contenu |
|---|---|---|
| `project_list` | `project_list_result` | `{project_ids, project_roots:[{project_id, identity: "folder"\|"addon", module_id?}], resource_inventory}` — ce que le serveur a chargé (instantané), pas un scan disque. |
| `project_read` | `project_read_result` | Requête `{project_id, if_hash?}`. Réponse `{hash, files:[{path, content}], failed:[{path, reason}], binaries:[{path, hash, size}]}`, ou `{unchanged: true, hash}` si `if_hash` égale l'empreinte. Binaires annoncés, pas portés. Plafond 8 MiB de texte (`too_large`). Chemins invisibles exclus (cf. `invariants.md`). |
| `project_write` | `project_write_result` | `{project_id, operation_id, files:[{path, content, base_hash}], deletes:[{path, base_hash}], renames:[{from, to, base_hash}], binaries?:[{path, content_base64\|null, base_hash}], create?}`. CAS par fichier, tout ou rien ; conflit : `{error: "conflict", conflicts:[{path, disk}], disk_files}`. `create` crée le dossier d'un Project neuf. Un `operation_id` rejoué rend la réponse déjà donnée. |
| `project_history` | `project_history_result` | `{project_id, path}` → `versions:[{at, content}]`, plus récente d'abord, lues dans `.artisan/history/<path>/`. Rien n'alimente plus ce dossier (`ProjectPublisher.withHistory` est l'identité) : seules les archives antérieures restent lisibles. |
| `asset_read` | `asset_read_result` | `{project_id, path}` → `{content_base64, hash}`, lu sur le disque à la demande. |
| `project_draft_request` | `project_draft_result` | Brouillons privés, cf. ci-dessous. |
| `project_create` | `project_create_result` | `{project_id}` : dossier vide sous la racine core. Nom `[A-Za-z0-9][A-Za-z0-9_-]{0,127}` hors noms réservés Windows, sinon `invalid_name` ; déjà pris (casse ignorée, ou racine d'Add-on) `project_exists`. Mineure 1. |
| `project_delete` | `project_delete_result` | `{project_id}` : dossier déplacé dans `<racine>/.artisan-trash/<id>-<horodatage UTC>/`, jamais effacé. `unknown_project`, `addon_immutable`. Mineure 1. |
| `project_rename` | `project_rename_result` | `{project_id, target_project_id}` : déplacement atomique du dossier, `.artisan/` (brouillons, journaux) compris. `destination_exists` (jamais d'écrasement), `invalid_path`, `unknown_project`, `addon_immutable`. Pas de journal de reprise. Mineure 1. |
| `config_read` | `config_read_result` | `{project_id, table}` → `files:[{path, content}]` (dossier de YAML ou `<table>.yaml`), plafond 1 MiB. |
| `config_write` | `config_write_result` | `{project_id, files:[{path, content}], deletes}` : écriture directe d'une table d'écran de config, puis rechargement. |
| `server_config_write` | `server_config_write_result` | `{changes}` : chaque clé validée (clé connue, type du défaut, chemins sous la racine, refs `projet:image`), `config.yml` réécrit, rechargement. Réponse `{server_config?, error?: "invalid_config"}`. Rien n'est écrit si un changement est refusé. |
| `online_players_fetch` | `online_players_result` | `players` triés. Hors ligne ou timeout : la route rend une liste vide. |
| `papi_placeholders_fetch` | `papi_placeholders_result` | `{placeholders:[{placeholder, expansion}], truncated}` ; 2 000 entrées max. |
| `head_texture_fetch` | `head_texture_result` | `{id}` (id HeadDatabase, 1–10 chiffres) → `texture` base64. Erreurs `hdb_unavailable`, `head_not_found`, `invalid_input`, `fetch_error`. |
| `player_inventory_fetch` | `player_inventory_result` | `{player}` → `slots:[{slot, stack_yaml, display}]` (0-35, armure 36-39, main gauche 40). `player_not_found`. |
| `data_source_fetch` | `data_source_fetch_result` | `{ref, params, filter, sort, limit, args}` → `{rows, truncated}` (50 lignes, ≤ 256 Ko). `unknown_source`, `player_required`, `fetch_error`. |
| `nexo_glyphs_list` / `nexo_glyph_read` | `nexo_glyphs_list_result` / `nexo_glyph_read_result` | Glyphes Nexo lus dans `plugins/Nexo/glyphs/` (sans API Nexo) ; `{glyphs:[{id, texture, available}]}` puis `{content_base64}`. |
| `custom_items_request` | `custom_items_bundle` | Sans `request_id`. Le serveur répond `{hash, data}`, `data = base64(gzip(zip))`, catalogue dans `items.json`. |
| `resource_pack_updated` | — | `{url, hash}` : le pack que le hub vient de recevoir pour ce serveur, servi sous `/resource-pack/<sha1>.zip`. Le serveur l'applique (délégation ou envoi direct, `ResourcePackManager`) ; une feuille le télécharge par l'adresse du hub qu'elle connaît (`web.hub-url`), les joueurs par l'URL publique. |

### Serveur → hub (annonces et requêtes)

| Message | Contenu |
|---|---|
| `projects_reloaded` | `{projects:[{id, hash}]}` après chaque rechargement (`/artisan reload`, écriture, publication). Le hub le relaie aux onglets de l'éditeur sur `/ws/editor`, ids préfixés `<serveur>.` pour une feuille. Fire-and-forget. |
| `modules_changed` | `{installed_modules, data_sources, declared_models, editor_screens}` : un module s'est enregistré après le `hello` ; le hub remplace ces champs. |
| `custom_items_changed` | `{hash}` : Nexo/Oraxen/ItemsAdder rechargé ; le hub redemande le bundle. |
| `editor_link` | `{request_id, player_id, player_name, permissions, host?}` : `/artisan editor` tapé sur une feuille. Le hub ne consulte aucune permission, il reprend celles lues par la feuille (`artisan.editor.view` requis) et répond `editor_link_result` `{ok, url}` ou `{error: "too_soon", retry_after}` / `invalid_input`. Timeout feuille 15 s. |

### Brouillons privés (`project_draft_request`)

Requête `{project_id, owner_id, action, …}` ; `owner_id` est l'UUID du joueur de la session,
fourni par le hub, jamais par l'éditeur. Actions servies par le hub :
`list`, `read`, `read_blob`, `create`, `update`, `discard`, `publish`, `write_blob`.
`ProjectDraftStore` (`core`) accepte aussi `import`, `list_all` et `purge_owner`, qu'aucune route
n'envoie plus.

- Mutations : `operation_id` (idempotence) ; un brouillon existant exige `expected_revision`.
- `create`/`update` portent `draft_id`, `name`, `snapshot` ; `write_blob` porte `hash`,
  `content_base64` sans avancer la révision.
- Stockage : `<project>/.artisan/drafts/<id>/draft.json` + blobs, journal de publication dans
  `.artisan/transactions/` (reprise après crash, reçus archivés dans `.receipts/`).
- `publish` écrit projet et état final du brouillon dans un seul commit atomique
  (`ProjectPublisher`), répond, **puis** recharge : un rechargement lent ne retient pas un
  reçu déjà acquis. `storage_error` = issue incertaine, rejouer le même `operation_id`.

### Quota commercial

`ProjectMutations` applique encore un quota si une mutation porte `commercial_policy`. Le hub
n'en envoie jamais : aucune limite ne s'applique.

## `/ws/editor`

WebSocket navigateur ← hub (`EditorChannel`). Ouverture : cookie de session portant
`artisan.editor.view` et en-tête `Origin` de même hôte, sinon 403. Le hub n'y envoie que
`projects_reloaded` `{server_key_id, projects:[{id, hash}]}` ; il ne lit rien du navigateur.
`POST /api/v1/user/ws-ticket` rend un ticket factice (`"session"`) : l'éditeur hérité en
demande un, le cookie suffit.

## Supprimé en phase F (ne pas réintroduire sans ADR)

`draft_update`, `ping`/`pong` applicatifs, `project_deleted`, `project_copy`,
l'ancien `project_rename` à `operation_id` et journal (+ `hello.project_rename_results`), `asset_write`, `plugin_update`,
`member_add`, `import_sources_list|read`, `bundle_available`, ainsi que les champs de `hello`
`capabilities`, `content_version`, `snapshot_hashes`, `local_project_ids`,
`editor_access_mode`. État cloud récupérable au commit `f085f576` (branche `v2`).

## Côté plugin : un gestionnaire par message

Un message entrant devient une `EditorRequest` (`core`, package `protocol`), type scellé.
`SyncedMenuProvider.dispatch` route chaque type par un `when` exhaustif ; ajouter un message
sans gestionnaire ne compile pas.

| Gestionnaire | Module | Messages |
|---|---|---|
| `ProjectReads` | `core` | `project_list`, `project_read`, `project_history`, `asset_read`, `config_read` |
| `ProjectWrites` | `core` | `project_write`, `config_write`, `project_draft_request`, `project_create`, `project_delete`, `project_rename` (disque : `ProjectFolders`) |
| `ServerQueries` | `paper` | `online_players_fetch`, `papi_placeholders_fetch`, `head_texture_fetch`, `player_inventory_fetch`, `data_source_fetch`, `server_config_write`, `nexo_glyph*` |
| `SyncedMenuProvider` | `paper` | `hello_ack`, `resource_pack_updated`, `session_replaced`, `custom_items_request` |

Les gestionnaires `core` ne voient les Projects qu'à travers `ProjectWorkspace` (instantané,
exécuteur disque, rechargement). Toute réponse part par `Replies` ; aucune I/O bloquante sur le
thread du callback WebSocket (cf. `invariants.md`).
