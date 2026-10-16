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
| WebSocket `/ws/plugin` | Une feuille du réseau (`web.hub` renseigné) | `WsClient` côté feuille, `PluginChannel` + `RemoteServer` côté hub, timeout 30 s par requête. |

Le hub n'interprète aucun contenu : chaque route REST de l'éditeur devient un message du
protocole (`project_read`, `project_write`, `project_draft_publish`…) passé par `ServerLink`
(`core`) aux gestionnaires existants (cf. `rest-endpoints.md`).

## Connexion d'une feuille

Une feuille se connecte à l'adresse WebSocket dérivée de `web.hub` (`hubWebSocketUrl`, `PluginConfig.kt` :
`"10.0.0.5:8765"` → `ws://10.0.0.5:8765/ws/plugin`, hôte nu → port 8765, `https://…` → `wss://…`,
URL `ws(s)://` gardée telle quelle) et envoie `hello`.
Reconnexion avec backoff exponentiel (1 s → 60 s) ; ping OkHttp toutes les 30 s. La feuille
n'ouvre pas la socket tant que sa base de suite n'est pas ouverte (`database_id` inconnu,
issue #42) : elle réessaie toutes les 2 s. Le hub dont la base s'ouvre encore ferme un `hello`
en 1008 (« not open yet: retry ») ; la feuille revient par son backoff.

**`hello`** (feuille → hub). Champs envoyés par `WsClient` et lus par le hub :

| Champ | Lu par le hub pour |
|---|---|
| `protocol_version` | `ProtocolVersion.CURRENT` (`"1.1"`). Majeure différente de celle du hub : serveur listé `updateRequired`, plus rien ne lui est envoyé (503 `plugin_update_required`). Mineure inférieure à 1 : pas de `project_create`/`_delete`/`_rename` (501 `plugin_update_required`). |
| `server_key` | Le **secret du réseau** (nom de champ hérité). Comparé en temps constant ; faux ou vide : fermeture 1008. |
| `server_uuid` | Server id du serveur (`plugins/Artisan/server-id`) : son identité partout — `/api/v1/servers/:server`, `server_key_id`, préfixe de ses Projects (`<server id>.<dossier>`), clé de `Servers`. Absent, ou égal à celui du hub (dossier copié) : fermeture 1008. |
| `database_id` | Identifiant de la base de suite (`artisan_meta`, généré une fois). Le hub refuse un `hello` dont l'identifiant diffère du sien, et tout `hello` s'il est lui-même en H2 : un réseau partage une base MySQL/MariaDB. |
| `proxy_name` | Nom du serveur dans le réseau (clé racine `name`, sinon le nom du dossier du serveur). `[A-Za-z0-9_-]{1,64}`. Un attribut : le libellé dans la liste des serveurs ; un serveur renommé garde son id. |
| `plugin_version`, `minecraft_version` | Affichés dans la liste des serveurs ; la version Minecraft choisit le catalogue d'items. |
| `installed_modules` | `[{id, version}]` : présence des modules (`GET …/modules`). |
| `data_sources` | `[{ref, module_id?, schema?, schema_hint?, stability?, key_field?}]` (`DataSourceReport`). `schema[]` = `{name, type, description}`, `type` étant le kind du `ModelFieldType` du champ (`string`, `number`, `integer`, `boolean`, `list`, `object`, `item` pour un champ déclaré par `FieldKind`, comme en 1.x ; `ltext`, `enum`, `map`… possibles depuis l'API 2.0.0). L'éditeur traite un kind qu'il ne connaît pas comme du texte. |
| `declared_models` | Documents `model/v1` déclarés par les modules : `ModelDeclaration.toWire()`, ou la map de `declare(Map)` (`@Sunset`) verbatim. |
| `editor_screens` | Écrans de config déclarés : `{id, module_id, label, table, project_id}`. |
| `declared_actions` | Actions enregistrées dans `ActionRegistry`, celles d'Artisan comprises : `{name, args: [ModelField], primary?, module_id?}` (`module_id` absent = action core). L'éditeur en tire le sélecteur et le formulaire des actions de module (`GET …/actions`, ADR `extensible-document-kinds` R1). |
| `document_kinds` | Kinds de Document enregistrés dans `DocumentKindRegistry`, ceux d'Artisan compris : `{kind, dir, schema_versions, id_prefix?, module_id?}` (`module_id` absent = kind core). L'éditeur compare avec les kinds que ses modules contribuent et signale un kind que le serveur actif ne liste pas (`GET …/document-kinds`, ADR `extensible-document-kinds` W6). Absent d'un `hello` antérieur à 2.1.0 : rien n'est signalé. |
| `server_config` | `config.yml` éditable en clés pointées (jamais `environment.yml`). |

`RemoteServer` lit aussi `custom_items_hash` s'il est présent (ancien `hello`) ; `WsClient` ne
l'envoie plus, l'empreinte suit par `custom_items_changed`.

**`hello_ack`** (hub → feuille) : `{session_id, server_id, editor_url, network_name,
resource_pack}`. `server_id` reprend le `server_uuid` du `hello`, `network_name` le nom du
serveur du hub. `resource_pack` vaut le dernier pack que le hub a servi à ce serveur
(`{url, hash}`), ou `{}` : un objet sans adresse laisse au serveur le pack qu'il a déjà
(`PackUpdate.Incomplete`), `null` le lui retirerait. Le hub applique le `hello` (version de
protocole, modules, configuration) avant d'envoyer `hello_ack` : une requête de l'éditeur qui suit
l'ack voit le serveur tel qu'il s'est annoncé, jamais avec un `hello` vide. Avant `hello_ack`,
`WsClient.request` répond `null` sans rien envoyer.

**`session_replaced`** (hub → feuille) : un autre serveur s'est connecté avec le même server id ;
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
| `project_draft_publish` | `project_draft_publish_result` | Publication d'un brouillon gardé par le hub, cf. ci-dessous. |
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
| `resource_pack_updated` | — | `{url, hash}` : le pack que le hub vient de recevoir pour ce serveur, servi sous `/resource-pack/<sha1>.zip`. Le serveur le délègue à son plugin de pack (Nexo, Oraxen, ItemsAdder ; `ResourcePackManager`, `resource-pack.delegate-to-dir`) qui l'envoie aux joueurs ; Artisan n'envoie jamais de pack lui-même. Une feuille le télécharge par l'adresse du hub qu'elle connaît (`web.hub`). |

### Serveur → hub (annonces et requêtes)

| Message | Contenu |
|---|---|
| `projects_reloaded` | `{projects:[{id, hash}]}` après chaque rechargement (`/artisan reload`, écriture, publication). Le hub le relaie aux onglets de l'éditeur sur `/ws/editor`, ids préfixés `<server id>.`. Fire-and-forget. |
| `modules_changed` | `{installed_modules, data_sources, declared_models, editor_screens, declared_actions, document_kinds}` : un module s'est enregistré après le `hello` ; le hub remplace ces champs. |
| `custom_items_changed` | `{hash}` : Nexo/Oraxen/ItemsAdder rechargé ; le hub redemande le bundle. |
| `editor_link` | `{request_id, player_id, player_name, permissions, host?}` : `/artisan editor` tapé sur une feuille. Le hub ne consulte aucune permission, il reprend celles lues par la feuille (`artisan.editor.view` requis) et répond `editor_link_result` `{ok, url}` ou `{error: "too_soon", retry_after}` / `invalid_input`. Timeout feuille 15 s. |
| `editor_permissions` | `{players: {uuid: [permissions]}}` : chaque minute, les permissions éditeur des joueurs en ligne. Le hub les applique aux sessions que ce serveur a émises et ferme celles d'un joueur sans `artisan.editor.view`. Pas de réponse. |
| `editor_logout` | `{request_id, player_id}` : `/artisan editor logout` tapé sur une feuille. Le hub ferme toutes les sessions du joueur et répond `editor_logout_result` `{ok, closed}`. |

### Brouillons privés (`project_draft_publish`)

Les brouillons vivent dans la base de la suite et le hub les sert lui-même (`ProjectDrafts`,
ADR `server-identity-and-versions`), serveur éteint compris : `list`, `read`, `read_blob`,
`create`, `update`, `discard`, `write_blob` ne vont jamais au serveur. `owner_id` est l'UUID du
joueur de la session, fourni par le hub. Mutations : `operation_id` (reçu en base, rejouable) ;
un brouillon existant exige `expected_revision`. Les blobs vont dans `artisan_contents`.

Seule la publication va au serveur : `project_draft_publish` `{project_id, operation_id, draft,
blobs: {hash: base64}, author_id, author_name}` (les binaires que le brouillon change).
`DraftPublication` (`core`) vérifie chaque fichier contre le disque (compare-and-swap), écrit tout
en un commit avec son reçu (`.artisan/transactions/`), répond `{ok, wrote}` ou `conflict`, **puis**
recharge. Le hub ne marque le brouillon publié qu'après cette réponse ; une réponse perdue se
rejoue sous le même `operation_id`, que le serveur reconnaît.

### Quota commercial

`ProjectMutations` applique encore un quota si une mutation porte `commercial_policy`. Le hub
n'en envoie jamais : aucune limite ne s'applique.

## `/ws/editor`

WebSocket navigateur ← hub (`EditorChannel`). Ouverture : cookie de session portant
`artisan.editor.view` et en-tête `Origin` de même hôte, sinon 403. Le hub n'y envoie que
`projects_reloaded` `{server_key_id, projects:[{id, hash}]}` (`server_key_id` = server id, le hub
compris) ; il ne lit rien du navigateur.
L'éditeur l'ouvre directement (`new EditorWs(handlers)`), sans ticket : le cookie suffit.

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
| `ProjectWrites` | `core` | `project_write`, `config_write`, `project_draft_publish`, `project_create`, `project_delete`, `project_rename` (disque : `ProjectFolders`) |
| `ServerQueries` | `paper` | `online_players_fetch`, `papi_placeholders_fetch`, `head_texture_fetch`, `player_inventory_fetch`, `data_source_fetch`, `server_config_write`, `nexo_glyph*` |
| `SyncedMenuProvider` | `paper` | `hello_ack`, `resource_pack_updated`, `session_replaced`, `custom_items_request` |

Les gestionnaires `core` ne voient les Projects qu'à travers `ProjectWorkspace` (instantané,
exécuteur disque, rechargement). Toute réponse part par `Replies` ; aucune I/O bloquante sur le
thread du callback WebSocket (cf. `invariants.md`).
