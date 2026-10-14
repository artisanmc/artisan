# Routes REST du hub — index

> Le serveur web de l'éditeur (module `plugin/hub`, Jetty 12) sert l'éditeur, son API et ses
> WebSockets sur `web.port` (8765 par défaut). Source de vérité : les fichiers `*Routes.kt` de
> `plugin/hub/src/main/kotlin/net/artisanmc/plugin/hub/`, assemblés par `EditorApi.router`.
> ADR `editor-web-server`.

Depuis la phase F (2026-10), il n'y a plus de backend. Le hub sert le **sous-ensemble** des
routes que l'éditeur appelait sur le backend, sous les mêmes chemins, pour que l'éditeur
change le moins possible : un réseau unique nommé `local`, ses serveurs (`local` pour celui
qui héberge le hub, le `proxy_name` de chaque feuille sinon), et un Project identifié par le
nom de son dossier (`shop`) ou `<serveur>.<dossier>` hors du serveur du hub (`survie2.shop`,
`Servers.project`).

## Conventions

- **Session obligatoire** : toute route `/api/` porte une permission (`Router.on(…, permission)`).
  Sans cookie `artisan_session` valide → 401 `unauthorized` ; sans la permission → 403
  `forbidden`. Permissions : `artisan.editor.view` (lire), `.edit` (brouillons), `.publish`
  (publier, écrans de config, pack), `.config` (configuration du serveur).
- **Même origine** : une requête autre que `GET` dont l'en-tête `Origin` ne désigne pas l'hôte
  qui répond → 403 `cross_origin`. Idem à l'ouverture de `/ws/editor`.
- **Erreurs** : `{error, message?}`. Chemin `/api/` inconnu → 404, méthode inconnue sur un
  chemin connu → 405. Exception d'un handler → 500 `internal_error`.
- **Relais** (`Relay`) : chaque route qui touche un serveur envoie un message du protocole
  (cf. `ws-protocol.md`). Serveur `updateRequired` → 503 `plugin_update_required` ; hors
  ligne → 503 `server_offline` ; timeout → 504 `fetch_timeout` ; échec → 502 `fetch_error`.
  Lecture de Project refusée (`readError`) : `unknown_project`/`not_found` 404,
  `invalid_path` 422, `write_error`/`storage_error` 503.
- **Versionnage** : tout sous `/api/v1/` ; éditeur et hub voyagent dans le même jar, l'API
  n'est plus un contrat entre deux déploiements (cf. `versioning.md`).

## Hors API

| Chemin | Fichier | Rôle |
|---|---|---|
| `GET /login/<jeton>` | `HubServer.kt` | Échange le lien de `/artisan editor` (usage unique, 60 s) contre une session de 12 h : cookie `HttpOnly`, `SameSite=Strict`, `Secure` si la requête l'est. Jeton invalide → `/login?expired=1`. |
| `WS /ws/editor` | `HubServer.kt`, `EditorChannel.kt` | Annonces aux onglets ouverts. |
| `WS /ws/plugin` | `PluginChannel.kt` | Feuilles du réseau, authentifiées par le secret partagé au `hello`. Pas de session navigateur. |
| `GET /resource-pack/<sha1>.zip` | `PackRoutes.kt` | **Public** (les clients Minecraft le téléchargent) ; `PackStore` garde les trois derniers. |
| `GET /*` | `EditorAssets.kt` | Build de l'éditeur embarqué (`-PwithEditor`) ; tout chemin inconnu rend `index.html`. Sans build embarqué : 503 texte. |

## Index par fichier de routes

`SERVER` = `/api/v1/networks/:network/servers/:server` (`:network` vaut toujours `local`).

| Fichier | Routes | Notes |
|---|---|---|
| `AccountRoutes.kt` | `GET/PATCH /api/v1/auth/me`, `POST /api/v1/auth/logout`, `POST /api/v1/user/ws-ticket`, `GET /api/v1/networks`, `GET /api/v1/networks/:network`, `GET /api/v1/networks/:network/servers-status` | Le joueur de la session (UUID, nom, permissions) sous la forme d'un compte. `PATCH` enregistre ses préférences (`PlayerPrefs`) : `editor_language`, `theme` (`dark`/`light`/`null`), `editor_tour` (`start` → `tourStarted`, `progress`, `complete`, `import`, règles du backend) ; corps ≤ 4 Ko sinon 400 `invalid_body`, valeur refusée → 422 `invalid_*`, clé inconnue ignorée. Le réseau `local`, ses serveurs et leur état (`online`, `lastSeenAt` depuis `artisan_servers`, `updateRequired`, versions). |
| `ServerRoutes.kt` | `GET SERVER/modules`, `/data-sources`, `/models`, `/screens`, `/editor-access` ; `GET` + `PATCH SERVER/server-config` ; `POST SERVER/config/read`, `/config/write` ; `GET SERVER/players`, `/papi-placeholders`, `/head-texture?id=`, `/player-inventory?player=` ; `POST SERVER/data-sources/preview` | Ce que le serveur déclare (lu en mémoire, sans aller-retour), sa configuration, ses écrans de config et ses données live. `editor-access` est toujours ouvert (plus de quota). |
| `ProjectRoutes.kt` | `GET SERVER/projects` ; `GET /api/v1/user/projects/:project` ; `GET /api/v1/projects/:project/editor-access` ; `GET` + `PUT …/files` et `GET …/history?path=` sous `/api/v1/projects/:project` et `SERVER/projects/:project` ; `GET /api/v1/projects/:project/binary?path=`, `GET SERVER/projects/:project/asset?path=` ; `GET /api/v1/projects/:project/versions[/:version]`, `GET …/versions/:version/binary?path=` | Liste, lecture (`if_hash`) et octets d'un asset lus en base (`LoadedProjects`, repli sur le serveur) ; serveur éteint : la lecture porte `offlineSince` (dernière présence) et `connection.available` vaut `false` — l'éditeur ouvre le projet, point de statut rouge, Publier désactivé, publication directe (`project_write`, CAS), historique d'un fichier, octets d'un asset. Capacités annoncées : renommer et supprimer pour un Project `folder` d'un serveur qui parle la mineure 1 du protocole ; copier vers un serveur et assistant **désactivés**. Versions et historique d'un fichier lus en base par le hub (`ProjectHistory`, `artisan_versions`), serveur éteint compris ; sans base, l'historique d'un fichier retombe sur les archives `.artisan/history/`. Une publication porte `author_id`/`author_name` de la session. |
| `ProjectRoutes.kt` (cycle de vie) | `POST /api/v1/networks/:network/projects` `{name, serverKeyId}` ; `DELETE /api/v1/user/projects/:project` ; `POST /api/v1/projects/:project/rename` `{targetId}` | `artisan.editor.publish`. `project_create` (201 `{project}`), `project_delete` (dossier déplacé dans `.artisan-trash/` du serveur), `project_rename` (`{projectId, diskId}`, brouillons inclus). `project_exists`/`destination_exists`/`addon_immutable` 409, `invalid_name`/`invalid_path` 422, `unknown_project` 404. Feuille d'une release antérieure (protocole `1.0`) : 501 `plugin_update_required` sans rien lui envoyer. |
| `ProjectRoutes.kt` (brouillons) | `GET/POST /api/v1/user/projects/:project/drafts`, `GET/PUT/DELETE …/drafts/:draft`, `POST …/drafts/:draft/publish`, `POST …/drafts/:draft/blobs`, `GET …/drafts/:draft/blobs/:hash` | Servies par le hub sur la base (`ProjectDrafts`), serveur éteint compris ; seule la publication part au serveur (`project_draft_publish`). `owner_id` = UUID de la session. Mutations : `revision` ≥ 1 et `operationId` (`[a-zA-Z0-9_-]{1,100}`, généré s'il manque). Statuts : `not_found` 404, `draft_conflict`/`draft_exists`/`draft_closed`/`conflict`/`operation_*` 409, `storage_error` 503. |
| `ItemRoutes.kt` | `GET /api/v1/user/projects/:project/items`, `/custom-items`, `/nexo-glyphs`, `/nexo-glyphs/:glyph` ; `GET /api/v1/textures/:version/*` | Catalogue vanilla embarqué (version la plus proche de celle du serveur), items Nexo/Oraxen/ItemsAdder du serveur du Project, textures vanilla extraites du jar client Mojang (`VanillaAssets`, la version demandée est ignorée), glyphes Nexo. Les items custom ne portent que `{id, label, category}` (spec `custom-items-names-only`) : pas de `textures/custom/…`, l'éditeur leur garde un placeholder. Pas de `model-bundle` ni de `models/…` non plus : le catalogue embarqué pointe vers des icônes 3D déjà rendues (`gen-icons.ts`), seul le générateur hors ligne sert ces routes. |
| `PackRoutes.kt` | `PUT SERVER/resource-pack` ; `GET /resource-pack/:file` | L'éditeur envoie le zip qu'il a construit (≤ 100 Mo, doit commencer par `PK`) ; le hub le range sous son SHA-1 et le remet au serveur (`applyResourcePack` en process, `resource_pack_updated` pour une feuille). |

## Flux non évidents

- **Publier** passe par le brouillon (`POST …/drafts/:draft/publish`) ; `PUT …/files` reste la
  publication directe (`project_write`, `create: true` pour un Project neuf). Les deux finissent en CAS contre le disque.
- **Après publication**, l'éditeur reconstruit le pack dans le navigateur
  (`editor/src/lib/pack/buildServerPack.ts`) puis le `PUT` au hub : le serveur ne calcule rien.
- **Feuille** : la même route sert un serveur distant ; seul le transport change
  (`RemoteServer` au lieu de `LocalServerLink`).

## Supprimé en phase F (ne pas réintroduire sans ADR)

Comptes (inscription, connexion e-mail/Google/Discord, suppression), réseaux multiples,
membres, invitations, demandes d'accès, transferts, clés serveur et codes de liaison,
démo, facturation et crédits, administration, assistant IA et sources d'import, copie de
Project vers un autre serveur, miroir d'instantané, diffusion et mise à jour
signée du jar. État cloud récupérable au commit `f085f576` (branche `v2`).
