# Routes REST du hub — index

> Le serveur web de l'éditeur (module `plugin/hub`, Jetty 12) sert l'éditeur, son API et ses
> WebSockets sur `web.port` (8765 par défaut). Source de vérité : les fichiers `*Routes.kt` de
> `plugin/hub/src/main/kotlin/net/artisanmc/plugin/hub/`, assemblés par `EditorApi.router`.
> ADR `editor-web-server`.

Depuis la phase F (2026-10), il n'y a plus de backend. Le hub sert ses propres routes, sans
plus imiter celles du backend (phase H, issue #44) : ses serveurs sous `/api/v1/servers`
(celui qui héberge le hub en premier, puis chaque feuille par nom), et un Project identifié par
`<server id>.<dossier>` sur tout serveur, celui du hub compris (`f3a1….shop`, `Servers.project` ;
le dossier seul répond `unknown_project`). Plus de `network`, de ticket WS ni d'`editor-access` : le cookie de
session suffit partout, et aucun quota ne s'applique.

## Conventions

- **Session obligatoire** : toute route `/api/` porte une permission (`Router.on(…, permission)`).
  Sans cookie de session valide (`__Host-artisan_session` derrière HTTPS ou `X-Forwarded-Proto: https`, sinon `artisan_session` ; le premier gagne) → 401 `unauthorized` ; sans la permission → 403
  `forbidden`. Permissions : `artisan.editor.view` (lire), `.edit` (brouillons), `.publish`
  (publier, écrans de config, pack), `.config` (configuration du serveur).
- **Même origine** : une requête autre que `GET` dont l'en-tête `Origin` ne désigne pas l'hôte
  qui répond → 403 `cross_origin`. Idem à l'ouverture de `/ws/editor`. Exception : les routes
  `crossOrigin` (`Router.on(…, crossOrigin = true)`, MCP et OAuth, ADR `mcp-server`) acceptent tout
  `Origin`, sans permission déclarée ; appelées depuis une autre origine, elles ne reçoivent **pas**
  de session (le cookie n'agit jamais pour un autre site) et vérifient leurs propres identifiants.
- **Erreurs** : `{error, message?}`. **Le code décide, jamais le statut seul** : un seul mapping
  code → statut, `ErrorStatus` (`Relay.kt`), partagé par toutes les routes. Un 404 est
  `unknown_project` (`:project` ne désigne aucun serveur/dossier connu, ou le serveur ne l'a pas
  chargé), `draft_not_found` (pas de brouillon de cet id pour ce propriétaire) ou `not_found`
  (chemin `/api/` inconnu, fichier, joueur) ; l'éditeur ne traite que le second comme « brouillon
  disparu ». Méthode inconnue sur un chemin connu → 405. Exception d'un handler → 500
  `internal_error`.
- **Relais** (`Relay`) : chaque route qui touche un serveur envoie un message du protocole
  (cf. `ws-protocol.md`). Serveur `updateRequired` → 503 `plugin_update_required` ; hors
  ligne → 503 `server_offline` ; timeout → 504 `fetch_timeout` ; échec → 502 `fetch_error`.
  Toute réponse refusée d'un serveur passe par `readError` → `ErrorStatus` : `*_not_found`/
  `unknown_*` 404, `invalid_*`/`missing_blob`/`player_required` 422, `too_large` 413,
  `conflict`/`*_exists`/`addon_immutable`/`draft_*`/`operation_*`/`too_soon` 409,
  `write_error`/`storage_error`/`server_offline`/`plugin_update_required` 503,
  `fetch_timeout` 504, inconnu 502.
- **Versionnage** : tout sous `/api/v1/` ; éditeur et hub voyagent dans le même jar, l'API
  n'est plus un contrat entre deux déploiements (cf. `versioning.md`).

## Hors API

| Chemin | Fichier | Rôle |
|---|---|---|
| `GET /login/<jeton>` | `HubServer.kt` | Échange le lien de `/artisan editor` (usage unique, 60 s) contre une session de 12 h : cookie `HttpOnly`, `SameSite=Strict`, `Secure` si la requête l'est. Jeton invalide → `/login?expired=1`. |
| `WS /ws/editor` | `HubServer.kt`, `EditorChannel.kt` | Annonces aux onglets ouverts. |
| `WS /ws/plugin` | `PluginChannel.kt` | Feuilles du réseau, authentifiées par le secret partagé au `hello`. Pas de session navigateur. |
| `GET /resource-pack/<sha1>.zip` | `PackRoutes.kt` | **Public** (les serveurs le téléchargent pour le déléguer à leur plugin de pack) ; `PackStore` garde les trois derniers. |
| `POST /mcp` | `McpRoutes.kt`, `McpTools.kt`, `McpProjects.kt` | Serveur MCP (Streamable HTTP sans état, réponses JSON, ADR `mcp-server`) si `web.mcp: true`. JSON-RPC `initialize` (versions `2025-11-25`, `2025-06-18`, `2025-03-26`), `ping`, `tools/list`, `tools/call` ; notification → 202 ; `GET`/`DELETE` → 405. Appelant : `Authorization: Bearer amcp_…` (jeton OAuth) ou cookie de session même origine ; sans → 401 `WWW-Authenticate: Bearer resource_metadata="…"` ; sans `artisan.editor.edit` → 403 `insufficient_scope`. Six outils : `artisan_overview`, `list_documents`, `read_document`, `get_kind_guide`, `start_draft` (brouillon `source: "ai"` du joueur), `write_document` (`documents_check` sur le serveur du Project, puis `update` du brouillon ; refus → `isError` avec les problèmes, brouillon inchangé). Actions de brouillon permises : `list`, `read`, `create`, `update` (`McpProjects.DRAFT_ACTIONS`) ; aucune publication. |
| `GET /.well-known/oauth-protected-resource[/mcp]`, `GET /.well-known/oauth-authorization-server` | `OAuthRoutes.kt` | Métadonnées RFC 9728 et RFC 8414 ; base = `X-Forwarded-Proto`/`X-Forwarded-Host`, sinon la requête. PKCE `S256` seul, clients publics (`none`). CORS `*` sans cookie. |
| `POST /oauth/register` | `OAuthRoutes.kt` | RFC 7591 : `{client_name, redirect_uris}` → 201 `{client_id: "mcp_…"}`. `https`, ou `http` sur `localhost`/`127.0.0.1`/`[::1]` ; 1 à 10 URI, sans fragment. 1 000 clients au plus : au-delà, ceux de plus d'une heure sans autorisation sont purgés. |
| `GET /oauth/authorize` | `OAuthRoutes.kt` | Client et `redirect_uri` connus → 302 vers la page de l'éditeur `/oauth/consent?…` ; sinon `/oauth/consent?error=invalid_client` (jamais de redirection vers une adresse non enregistrée). `response_type` ≠ `code` ou PKCE absent → retour au client avec `error`. |
| `POST /oauth/token` | `OAuthRoutes.kt` | Formulaire. `authorization_code` (`code`, `client_id`, `redirect_uri`, `code_verifier`) : code de 60 s, à usage unique, brûlé par un mauvais vérificateur ; `refresh_token` : les deux jetons tournent. Accès 1 h, rafraîchissement 30 j. Erreur → 400 `invalid_grant`, client inconnu 401 `invalid_client`. |
| `GET /*` | `EditorAssets.kt` | Build de l'éditeur embarqué (`-PwithEditor`) ; tout chemin inconnu rend `index.html`. Sans build embarqué : 503 texte. |

## Index par fichier de routes

`SERVER` = `/api/v1/servers/:server`, `:server` = server id (UUID de `plugins/Artisan/server-id`). Partout où le hub renvoie un serveur (`servers[].id`, `serverKeyId` d'un Project, `server_key_id` de `projects_reloaded`), c'est son UUID, le serveur du hub compris ; un id de Project est `<server id>.<dossier>` partout (issue #43 : plus de sentinelle `local`).

| Fichier | Routes | Notes |
|---|---|---|
| `AccountRoutes.kt` | `GET/PATCH /api/v1/auth/me`, `POST /api/v1/auth/logout`, `GET /api/v1/servers` | Le joueur de la session (UUID, nom, permissions) sous la forme d'un compte. `PATCH` enregistre ses préférences (`PlayerPrefs`) : `editor_language`, `theme` (`dark`/`light`/`null`), `editor_tour` (`start` → `tourStarted`, `progress`, `complete`, `import`, règles du backend) ; corps ≤ 4 Ko sinon 400 `invalid_body`, valeur refusée → 422 `invalid_*`, clé inconnue ignorée. `/servers` : `{servers: [{id, label, online, minecraftVersion, pluginVersion, lastSeenAt, updateRequired}]}`, le serveur du hub en premier (`lastSeenAt` depuis `artisan_servers`). |
| `ServerRoutes.kt` | `GET SERVER/modules`, `/data-sources`, `/models`, `/screens`, `/actions`, `/document-kinds`, `/game-events`, `/player-commands` ; `GET` + `PATCH SERVER/server-config` ; `POST SERVER/config/read`, `/config/write` ; `GET SERVER/players`, `/papi-placeholders`, `/head-texture?id=`, `/player-inventory?player=` ; `POST SERVER/data-sources/preview` ; `GET SERVER/modules/:module/ui.js?v=` ; `GET SERVER/modules/:module/templates/:template` | Ce que le serveur déclare (lu en mémoire, sans aller-retour), sa configuration, ses écrans de config et ses données live. `ui.js` : la vue éditeur d'un module (bundles de module, niveau 3, `modules.md`), cf. ci-dessous. |
| `ProjectRoutes.kt` | `GET SERVER/projects` ; `GET /api/v1/user/projects/:project` ; `GET` + `PUT …/files` et `GET …/history?path=` sous `/api/v1/projects/:project` et `SERVER/projects/:project` ; `GET /api/v1/projects/:project/binary?path=`, `GET SERVER/projects/:project/asset?path=` ; `GET /api/v1/projects/:project/versions[/:version]`, `GET …/versions/:version/binary?path=` | Liste, lecture (`if_hash`, comparé à l'empreinte de l'état chargé avant toute lecture de Version : un poll inchangé ne lit pas les fichiers) et octets d'un asset lus en base (`LoadedProjects`, repli sur le serveur) ; serveur éteint : la lecture porte `offlineSince` (dernière présence) et `connection.available` vaut `false` — l'éditeur ouvre le projet, point de statut rouge, Publier désactivé, publication directe (`project_write`, CAS), historique d'un fichier, octets d'un asset. Capacités annoncées (`liveData`, `captureInGame`, `preview`, `canRename`, `canDelete`) : renommer et supprimer pour un Project `folder` d'un serveur qui parle la mineure 1 du protocole. Versions et historique d'un fichier lus en base par le hub (`ProjectHistory`, `artisan_versions`), serveur éteint compris ; sans base, l'historique d'un fichier retombe sur les archives `.artisan/history/`. Une publication porte `author_id`/`author_name` de la session. |
| `ProjectRoutes.kt` (cycle de vie) | `POST SERVER/projects` `{name}` (serveur inconnu : 404 `not_found`, nom absent : 422 `invalid_input`) ; `DELETE /api/v1/user/projects/:project` ; `POST /api/v1/projects/:project/rename` `{targetId}` | `artisan.editor.publish`. `project_create` (201 `{project}`), `project_delete` (dossier déplacé dans `.artisan-trash/` du serveur), `project_rename` (`{projectId, diskId}`, brouillons inclus). `project_exists`/`destination_exists`/`addon_immutable` 409, `invalid_name`/`invalid_path` 422, `unknown_project` 404. Feuille d'une release antérieure (protocole `1.0`) : 501 `plugin_update_required` sans rien lui envoyer. |
| `ProjectRoutes.kt` (modèles) | `GET …/origins` et `POST …/templates` `{module, template, paths?, replace}` sous `/api/v1/projects/:project` et `SERVER/projects/:project` | ADR `module-templates`. `project_origins_fetch` (`{origins}`, `artisan.editor.view`) et `template_copy` (`artisan.editor.publish`, `{written, unchanged}`) ; fichier existant au contenu différent sans `replace` : 409 `{error: "conflict", conflicts}`, rien d'écrit. `unknown_path`/`invalid_input` 422. Feuille de mineure < 3 : 501 `plugin_update_required` sans relais. |
| `ProjectRoutes.kt` (brouillons) | `GET/POST /api/v1/user/projects/:project/drafts`, `GET/PUT/DELETE …/drafts/:draft`, `POST …/drafts/:draft/publish`, `POST …/drafts/:draft/blobs`, `GET …/drafts/:draft/blobs/:hash` | Servies par le hub sur la base (`ProjectDrafts`), serveur éteint compris ; seule la publication part au serveur (`project_draft_publish`). `owner_id` = UUID de la session. Mutations : `revision` ≥ 1 et `operationId` (`[a-zA-Z0-9_-]{1,100}`, généré s'il manque). Codes (`ErrorStatus`) : `draft_not_found` 404, `unknown_project` 404, `draft_conflict`/`draft_exists`/`draft_closed`/`conflict`/`operation_*` 409, `invalid_draft`/`invalid_blob`/`missing_blob` 422, `storage_error` 503 (la base a échoué, ou s'ouvre encore au démarrage — `LateSuiteData`, issue #42 ; une même opération envoyée deux fois à la fois reçoit le reçu de l'autre), sans base, relayé au serveur. Le reçu d'une opération ne garde pas le corps du brouillon : au rejeu, le brouillon courant est renvoyé. `PUT …/drafts/:draft` répond le brouillon **sans** `snapshot` (l'éditeur garde celui qu'il a envoyé) ; `GET` et le rejeu le renvoient entier. |
| `ItemRoutes.kt` | `GET /api/v1/user/projects/:project/items`, `/custom-items`, `/nexo-glyphs`, `/nexo-glyphs/:glyph` ; `GET /api/v1/textures/:version/*` | Catalogue vanilla embarqué (version la plus proche de celle du serveur), items Nexo/Oraxen/ItemsAdder du serveur du Project, textures vanilla extraites du jar client Mojang (`VanillaAssets`, la version demandée est ignorée), glyphes Nexo. Les items custom ne portent que `{id, label, category}` (spec `custom-items-names-only`) : pas de `textures/custom/…`, l'éditeur leur garde un placeholder. Pas de `model-bundle` ni de `models/…` non plus : le catalogue embarqué pointe vers des icônes 3D déjà rendues (`gen-icons.ts`), seul le générateur hors ligne sert ces routes. |
| `AddressRoutes.kt` | `GET` + `POST /api/v1/editor-address` | `artisan.editor.config`. L'adresse de l'éditeur sur le serveur de tunnel (ADR `editor-tunnel`, décision 8) : `{tunnel, connected, url, name, names, suffix}` ; sans tunnel `{tunnel: false}`. `POST {name, check}` : `check` dit seulement si le nom est libre, sinon le prend (`""` le rend) et renvoie `{name, url, login}`, `login` = lien de connexion sur la nouvelle adresse. Refus : `taken` 409, `invalid`/`reserved` 422, `too_many` 429, `unavailable`/`offline` 503 ; sans tunnel 404 `no_tunnel`. |
| `OAuthRoutes.kt` (éditeur) | `GET` + `POST /api/v1/oauth/consent` ; `GET /api/v1/user/mcp/grants`, `DELETE /api/v1/user/mcp/grants/:grant` | Si `web.mcp: true`. `GET` (`view`) : `{client: {name, redirectHost}, player, canEdit}` pour `client_id` + `redirect_uri` ; `POST` (`edit`, même origine) `{client_id, redirect_uri, state, code_challenge, approve}` → `{redirect}` vers le client, avec `code` ou `error=access_denied`. Le client autorisé agit avec les permissions du joueur moins `publish` et `config`, relues à chaque rapport de permissions (`Sessions.onPermissions`) ; sans `view`, l'autorisation est supprimée. Liste et révocation (`view`) : les clients du joueur, `{grants: [{id, client, createdAt, lastUsedAt}]}` ; une révocation agit au prochain appel. |
| `PackRoutes.kt` | `PUT SERVER/resource-pack` ; `GET /resource-pack/:file` | L'éditeur envoie le zip qu'il a construit (≤ 100 Mo, doit commencer par `PK`) ; le hub le range sous son SHA-1 et le remet au serveur (`applyResourcePack` en process, `resource_pack_updated` pour une feuille). |

## Flux non évidents

- **Publier** passe par le brouillon (`POST …/drafts/:draft/publish`) ; `PUT …/files` reste la
  publication directe (`project_write`, `create: true` pour un Project neuf). Les deux finissent en CAS contre le disque,
  après `DocumentCheck` : un Document qui ne chargerait pas → 422 `invalid_documents` `{error, message, problems}`, rien d'écrit.
- **Après publication**, l'éditeur reconstruit le pack dans le navigateur
  (`editor/src/lib/pack/buildServerPack.ts`) puis le `PUT` au hub : le serveur ne calcule rien.
- **Feuille** : la même route sert un serveur distant ; seul le transport change
  (`RemoteServer` au lieu de `LocalServerLink`).
- **Bundle éditeur d'un module** (`GET SERVER/modules/:module/ui.js`, `artisan.editor.view`) :
  404 `not_found` sans relais si l'entrée `installed_modules` du module n'annonce pas
  d'`editor_bundle` (feuille de mineure < 2 comprise). Sinon le hub sert sa copie du `hash` annoncé
  (`BundleCache` de `ServerRoutes` : 8 bundles, 16 MiB, le moins récemment servi sort), ou relaie
  `editor_bundle_fetch` ; le SHA-256 du contenu reçu doit égaler le `hash` de la réponse et celui
  de l'annonce (annonce périmée, module rechargé : 502 `fetch_error`), puis il est gardé. 200
  `text/javascript; charset=utf-8`, `X-Content-Type-Options: nosniff` ; `Cache-Control: private,
  max-age=31536000, immutable` si `?v=` égale le hash, `no-cache` sinon. Le module sans bundle côté
  serveur : 404 `not_found`.

## Supprimé en phase F (ne pas réintroduire sans ADR)

Comptes (inscription, connexion e-mail/Google/Discord, suppression), réseaux multiples,
membres, invitations, demandes d'accès, transferts, clés serveur et codes de liaison,
démo, facturation et crédits, administration, assistant IA et sources d'import, copie de
Project vers un autre serveur, miroir d'instantané, diffusion et mise à jour
signée du jar. État cloud récupérable au commit `ccade092` (branche `v2`).
