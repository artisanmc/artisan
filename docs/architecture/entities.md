# Modèle de données — ce qui persiste où

Depuis la phase F (2026-10), Artisan n'a plus de base centrale : ni PostgreSQL, ni comptes, ni
réseaux en base. Tout ce qui dure vit sur le disque de chaque serveur Minecraft ; le hub ne
garde en mémoire que l'état des serveurs connectés (les sessions éditeur sont dans la base de la suite). ADR `editor-web-server`.
L'ancien modèle cloud (45 tables, 66 migrations Drizzle) est récupérable au commit `ccade092`
(branche `v2`).

## Entités

| Entité | Identité | Où |
|---|---|---|
| **Server** | Server id (UUID de `plugins/Artisan/server-id`), le serveur du hub compris : routes `/api/v1/servers/:server`, `serverKeyId`, `server_key_id`, préfixe des ids de Project, clés de `Servers` (issue #43). Le nom (`name`, sinon le nom du dossier du serveur ; `proxy_name` du `hello`) est un attribut, le libellé affiché | `artisan_servers` (base de la suite) : `uuid` du fichier `plugins/Artisan/server-id`, `name`, `last_seen` rafraîchi chaque minute, `running` (faux après un arrêt propre), `editor_url` et `internal_url` (où répond son `/ws/plugin`, ADR `peer-servers`) (`ServerRegistry`). Un `name` changé renomme la ligne ; un server id qui tourne déjà sous un autre nom (dossier copié) ou un nom tenu par un autre server id est refusé au démarrage. Le hub liste les serveurs connus de la table, éteints compris ; sans base, une feuille déconnectée reste listée jusqu'au redémarrage du hub (`Servers`, `RemoteServer`). Tables d'Artisan migrées par `SchemaMigrator` (`artisan_schema_version`). |
| **Network** | Unique, sans nom ; `network_name` du `hello_ack` = nom du serveur du hub | Implicite : le hub et les feuilles qui partagent son secret. |
| **Project** | `<server id>.<dossier>` sur tout serveur, celui du hub compris (`f3a1….shop`, `Servers.project`) ; `externalId` = le dossier | Disque : `plugins/Artisan/modules/<dossier>/`, ou la racine qu'un add-on enregistre (`ProjectRootRegistry`, `identity: addon`). Cf. `project-files.md`. |
| **Brouillon privé** | `draft_id` dans un Project, propriétaire = UUID du joueur | Base de la suite : `artisan_drafts` (enveloppe JSON, clé = hash du `draft_id`, colonnes `status` et `updated_at` pour la purge), reçus dans `artisan_draft_receipts` (résultat **sans** le corps du brouillon : au rejeu, le brouillon est relu ; `created_at`), blobs dans `artisan_contents` (`ProjectDrafts`, hub ; accès par `SuiteProjectData`, paper). Brouillons fermés (publiés, abandonnés) et reçus purgés après 30 jours (`DraftRows.KEEP`), une fois par jour. Les anciens `.artisan/drafts/` ne sont plus lus. |
| **Journal de publication** | `operation_id` | Disque : `<project>/.artisan/transactions/` (en cours) et `.receipts/` (reçus rejoués à l'identique). |
| **Session éditeur** | Jeton aléatoire (cookie `__Host-artisan_session` en HTTPS, `artisan_session` sinon) ; porte UUID, nom et permissions du joueur | `artisan_editor_sessions` (clé = SHA-256 de l'id, jamais l'id) + cache mémoire du hub (`Sessions`). Expire après `web.session-days` (7) jours sans requête, survit au redémarrage. Sans base : mémoire seule. |
| **Lien de connexion** | Jeton à usage unique | Mémoire du hub, 60 s, un par joueur et par minute. |
| **Préférences d'éditeur** | UUID du joueur | Disque du hub : `plugins/Artisan/editor-prefs/<uuid>.json` (`PlayerPrefs`) : langue, thème, avancement du tour guidé. Écriture atomique, clés connues seules. |
| **Pack de ressources** | SHA-1 du zip | Disque du hub : `plugins/Artisan/cache/resource-pack/<sha1>.zip` (`PackStore`, trois derniers, un pack par serveur construit par l'éditeur). Dernier pack appliqué : `cache/resource-pack.json` sur chaque serveur. |

Pas d'utilisateur : l'identité dans l'éditeur est le joueur Minecraft qui a demandé le lien,
ses droits sont ses permissions `artisan.editor.view|edit|publish|config` au moment de la
demande (`artisan.editor` les donne toutes). L'accès se donne avec un plugin de permissions
(LuckPerms…), pas par invitation.

## Fichiers du plugin (`plugins/Artisan/`)

| Fichier | Contenu | Écrit par |
|---|---|---|
| `config.yml` | Réglages éditables (langue, pack de ressources, taille des pools…) | L'admin, ou l'éditeur (`server_config_write`, validé clé par clé). |
| `environment.yml` | `name` (nom du serveur), `web.*` (port, bind, url, hub, secret, tunnel), identifiants de base et `dev.editor-bundles` (vue éditeur d'un module lue depuis un fichier) | L'admin seul ; jamais lu ni écrit par l'éditeur. |
| `network-secret` | Secret du réseau généré par le hub quand ni `web.secret` ni Velocity n'en donnent ; les pairs d'une même base utilisent `network_secret` d'`artisan_meta` (ADR `peer-servers`) | Le hub, une fois. |
| `tunnel-secret` | Secret du tunnel de l'éditeur ; l'adresse `<id>` sur le serveur de tunnel en est dérivée (ADR `editor-tunnel`). Le nom de l'adresse (`survie.artisanmc.app`) n'est gardé que par le serveur de tunnel (`TUNNEL_NAMES_FILE`), qui le renvoie à chaque connexion | Le hub, une fois, s'il ouvre un tunnel (par défaut, sans `web.url`). |
| `projects/` | Les Projects | Le plugin (seul écrivain), sur geste de l'éditeur, ou l'admin à la main puis `/artisan reload`. |
| `editor-prefs/<uuid>.json` | Préférences d'éditeur d'un joueur (`PATCH /api/v1/auth/me`) | Le hub. |
| `cache/minecraft/<version>/` | Textures vanilla extraites du jar client Mojang (SHA-1 vérifié) | Le hub, à la première texture demandée. |
| `cache/resource-pack/`, `cache/resource-pack.json`, `cache/asset-index.json` | Packs servis (hub), dernier pack appliqué, index d'assets | `PackStore`, `ResourcePackManager`, `AssetCatalog`. |
| `database/suite.mv.db` | Base H2 par défaut | Les plugins de la suite. |

## Base de la suite

`environment.yml` → `database.type: h2 | mysql | mariadb`. Artisan y crée ses propres tables
(`artisan_servers`, Versions, brouillons…) et prête un pool de connexions par plugin de la suite
(`DatabaseApi`, `@Beta`), chaque plugin apporte ses tables et ses migrations (ADR
`suite-foundation-database`). Toutes les tables commencent par `database.table-prefix`
(`artisan_` par défaut) : `{prefix}servers` pour Artisan, `tablePrefix(module)` =
`{prefix}{module}_` pour un plugin. Le préfixe utilisé est noté dans
`plugins/Artisan/database/table-prefix` ; changé sous une base qui contient les tables de
l'ancien, `dataSource()` est refusé pour tous les plugins (`TablePrefix.checkUnchanged`). En réseau, MySQL ou
MariaDB permet aux serveurs de partager ces données ; une feuille sur H2 le signale au
démarrage, sans refuser de démarrer (brouillons et sessions n'en ont pas besoin).

## Ce que le hub retient d'un serveur

Lu au `hello`, mis à jour par `modules_changed`, `custom_items_bundle` et
`server_config_write_result` : modules installés, data sources, models déclarés, écrans de
config, `config.yml`, items custom, versions Minecraft et plugin, compatibilité du protocole.
Rien de tout cela n'est écrit sur disque côté hub. Pour le serveur du hub, ces valeurs sont lues
directement dans le plugin à chaque requête.

## Historique

- `.artisan/history/<chemin>/<ms>` : archives d'un fichier d'avant les Versions, lues par
  `project_history` quand la base est indisponible. Plus alimentées.
- **Versions** (ADR `server-identity-and-versions`) : `artisan_versions` (serveur, `project_key`
  de `.artisan/project-id` ou `addon:<id>`, dernier dossier, hash du manifeste, manifeste
  `t|b <hash> <taille> <chemin>`, auteur UUID + pseudo ou rien, date) et `artisan_contents`
  (hash → octets, texte et binaires, stockés une fois ; `MERGE` H2 / `INSERT IGNORE` MySQL, deux
  serveurs peuvent insérer le même hash). Chaque serveur enregistre la sienne à
  chaque Snapshot dont le manifeste diffère du précédent (`SyncedMenuProvider.onSnapshot` →
  `VersionRecorder` (core), thread `Artisan-versions`), **en une transaction** ; `.artisan*`
  hors manifeste. Les octets d'un binaire sont relus du disque au moment de l'enregistrement et
  re-hachés : s'ils ne correspondent plus au hash du Snapshot (publication ou édition entre-temps),
  l'entrée n'est pas stockée (avertissement), la Version suivante la reprendra.
  Passage de H2 à MySQL : `EmbeddedImport` recopie au premier démarrage Versions, contenus et
  brouillons du server id depuis le fichier H2 (ids réattribués), une fois : l'import et sa marque
  `imported:<server id>` dans `artisan_meta` sont une transaction, un import échoué se relance au
  démarrage suivant, un import fait ne se relance jamais. Migrations (`SchemaMigrator`) : chaque
  étape non rejouable (`ADD COLUMN`, `CREATE INDEX`, `ADD CONSTRAINT`) porte un prédicat `applied`
  lu dans le catalogue JDBC, car MySQL auto-commit le DDL ; `GET_LOCK` non obtenu = erreur.
  `artisan_server_state` (un JSON par serveur, réécrit à chaque chargement **si toutes les Versions
  du chargement ont été enregistrées** : sinon l'état précédent reste, cohérent avec les fichiers
  servis) : le contenu de `project_list` et, par Project, le hash du Snapshot, les fichiers en
  échec et `.artisan/editor.yaml` — un `LoadedState` (`core/protocol`, champ `schema`, absent des
  lignes plus anciennes qui se lisent comme `schema: 1` ; un champ inconnu est ignoré). Le hub lit la liste, les Projects et leurs assets dans ces deux
  tables (`LoadedProjects`, implémenté par `SuiteProjectData` dans `paper`, qui garde l'état parsé
  de chaque serveur 5 s et le jette dès que ce serveur enregistre ou annonce un rechargement) ;
  la dernière Version d'un dossier est lue par deux requêtes indexées, l'historique complet n'est
  chargé que par les routes d'historique. Le rechargement n'est annoncé qu'une fois enregistré.
  Sans base, il relaie au serveur.
  L'auteur vient de `author_id`/`author_name` des messages de publication du hub ;
  `restored_from` du `restoredFrom` du brouillon publié (restaurer une Version charge son texte
  et ses binaires, lus en base, dans le brouillon ; « Restaurer et publier » ouvre la revue).

## Phases (récit)

- Avril–juin 2026 : backend Bun/Hono + PostgreSQL, comptes, réseaux, clés serveur, branches.
- Août 2026 (`server-disk-only-storage`) : le contenu des Projects quitte la base pour le disque
  du serveur ; le backend ne fait plus que relayer.
- Septembre 2026 : brouillons et Versions en base, miroir d'instantané (`snapshot-mirror-and-backend-history`).
- Octobre 2026 (plan d'auto-hébergement, phases A à F) : le plugin sert l'éditeur ; brouillons
  sur disque ; réseau hub + feuilles ; le backend et toutes ses tables sont supprimés.
