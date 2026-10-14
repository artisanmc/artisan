# Modèle de données — ce qui persiste où

Depuis la phase F (2026-10), Artisan n'a plus de base centrale : ni PostgreSQL, ni comptes, ni
réseaux en base. Tout ce qui dure vit sur le disque de chaque serveur Minecraft ; le hub ne
garde en mémoire que les sessions et l'état des serveurs connectés. ADR `editor-web-server`.
L'ancien modèle cloud (45 tables, 66 migrations Drizzle) est récupérable au commit `f085f576`
(branche `v2`).

## Entités

| Entité | Identité | Où |
|---|---|---|
| **Server** | `local` pour le serveur qui héberge le hub ; `proxy_name` (`name`, sinon le nom du dossier du serveur) pour une feuille | `artisan_servers` (base de la suite) : `uuid` du fichier `plugins/Artisan/server-id`, `name`, `last_seen` rafraîchi chaque minute, `running` (faux après un arrêt propre) (`ServerRegistry`). Un `name` changé renomme la ligne ; un server id qui tourne déjà sous un autre nom (dossier copié) ou un nom tenu par un autre server id est refusé au démarrage. Le hub liste les serveurs connus de la table, éteints compris ; sans base, une feuille déconnectée reste listée jusqu'au redémarrage du hub (`Servers`, `RemoteServer`). Tables d'Artisan migrées par `SchemaMigrator` (`artisan_schema_version`). |
| **Network** | Unique, nommé `local` ; libellé = nom du dossier du serveur hub | Implicite : le hub et les feuilles qui partagent son secret. |
| **Project** | Nom de son dossier (`shop`) ; `<serveur>.<dossier>` hors du serveur du hub (`survie2.shop`) | Disque : `plugins/Artisan/projects/<dossier>/`, ou la racine qu'un add-on enregistre (`ProjectRootRegistry`, `identity: addon`). Cf. `project-files.md`. |
| **Brouillon privé** | `draft_id` dans un Project, propriétaire = UUID du joueur | Disque : `<project>/.artisan/drafts/<id>/draft.json` + blobs (`ProjectDraftStore`). |
| **Journal de publication** | `operation_id` | Disque : `<project>/.artisan/transactions/` (en cours) et `.receipts/` (reçus rejoués à l'identique). |
| **Session éditeur** | Jeton aléatoire (cookie `artisan_session`) ; porte UUID, nom et permissions du joueur | Mémoire du hub (`Sessions`), 12 h. Perdue au redémarrage du hub. |
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
| `environment.yml` | `name` (nom du serveur), `web.*` (port, bind, url, hub, secret) et identifiants de base | L'admin seul ; jamais lu ni écrit par l'éditeur. |
| `network-secret` | Secret du réseau généré par le hub quand ni `web.secret` ni Velocity n'en donnent | Le hub, une fois. |
| `projects/` | Les Projects | Le plugin (seul écrivain), sur geste de l'éditeur, ou l'admin à la main puis `/artisan reload`. |
| `editor-prefs/<uuid>.json` | Préférences d'éditeur d'un joueur (`PATCH /api/v1/auth/me`) | Le hub. |
| `cache/minecraft/<version>/` | Textures vanilla extraites du jar client Mojang (SHA-1 vérifié) | Le hub, à la première texture demandée. |
| `cache/resource-pack/`, `cache/resource-pack.json`, `cache/asset-index.json` | Packs servis (hub), dernier pack appliqué, index d'assets | `PackStore`, `ResourcePackManager`, `AssetCatalog`. |
| `database/suite.mv.db` | Base H2 par défaut | Les plugins de la suite. |

## Base de la suite

`environment.yml` → `database.type: h2 | mysql | mariadb`. Artisan **n'y crée aucune table** :
il prête un pool de connexions par plugin de la suite (`DatabaseApi`, `@Beta`), chaque plugin
apporte ses tables et ses migrations (ADR `suite-foundation-database`). En réseau, MySQL ou
MariaDB permet aux serveurs de partager ces données ; une feuille sur H2 le signale au
démarrage, sans refuser de démarrer (brouillons et sessions n'en ont pas besoin).

## Ce que le hub retient d'un serveur

Lu au `hello`, mis à jour par `modules_changed`, `custom_items_bundle` et
`server_config_write_result` : modules installés, data sources, models déclarés, écrans de
config, `config.yml`, items custom, versions Minecraft et plugin, compatibilité du protocole.
Rien de tout cela n'est écrit sur disque côté hub. Pour le serveur `local`, ces valeurs sont lues
directement dans le plugin à chaque requête.

## Historique

- `.artisan/history/<chemin>/<ms>` : archives d'un fichier d'avant les Versions, lues par
  `project_history` quand la base est indisponible. Plus alimentées.
- **Versions** (ADR `server-identity-and-versions`) : `artisan_versions` (serveur, `project_key`
  de `.artisan/project-id` ou `addon:<id>`, dernier dossier, hash du manifeste, manifeste
  `t|b <hash> <taille> <chemin>`, auteur UUID + pseudo ou rien, date) et `artisan_contents`
  (hash → octets, texte et binaires, stockés une fois). Chaque serveur enregistre la sienne à
  chaque Snapshot dont le manifeste diffère du précédent (`SyncedMenuProvider.onSnapshot` →
  `ArtisanPlugin.recordVersions`, thread `Artisan-versions`) ; `.artisan*` hors manifeste.
  `artisan_server_state` (un JSON par serveur, réécrit à chaque chargement) : le contenu de
  `project_list` et, par Project, le hash du Snapshot, les fichiers en échec et `.artisan/editor.yaml`.
  Le hub lit la liste, les Projects et leurs assets dans ces deux tables (`LoadedProjects`) ; le
  rechargement n'est annoncé qu'une fois enregistré. Sans base, il relaie au serveur.
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
