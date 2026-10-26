# Un serveur MCP dans le hub : l'IA écrit des brouillons, un humain déploie

**Statut :** accepté (2026-10-25), jalon 0, derrière `web.mcp` (désactivé par défaut). Suite de
`editor-web-server`, `editor-tunnel` et `server-identity-and-versions` (brouillons en base).

## Contexte

On veut qu'une IA aide à construire menus, commandes, dialogues et Triggers. Deux usages, une seule
porte : un assistant cloud intégré à l'éditeur (plus tard, sans clé d'IA chez l'admin), et les
clients que les joueurs ont déjà (Claude, ChatGPT, un IDE) via le Model Context Protocol. Proposition
complète : `architecture/integration-ia-mcp.html` (fichiers du projet).

Contraintes : Artisan est auto-hébergé, l'éditeur et l'API vivent dans le jar ; le contenu publié
vit sur le disque du serveur ; une IA se trompe, et un fichier qu'elle écrit atteint les joueurs dès
qu'il est déployé.

## Décisions

1. **Le serveur MCP est le hub.** `POST /mcp` sur l'adresse de l'éditeur (le tunnel par défaut :
   HTTPS sans port à ouvrir), Streamable HTTP **sans état**, réponses JSON seules : pas de flux SSE,
   pas de `Mcp-Session-Id`. `GET`/`DELETE` → 405. Versions du protocole : `2025-11-25`,
   `2025-06-18`, `2025-03-26`. Aucun nouveau service, aucune nouvelle dépendance réseau. Les outils
   bloquent sur les réponses des serveurs : sur 4 threads à eux, jamais ceux de Jetty.
2. **L'IA n'écrit que des brouillons.** Six outils : `artisan_overview`, `list_documents`,
   `read_document`, `get_kind_guide` (lecture), `start_draft`, `write_document` (brouillon privé du
   joueur, `source: "ai"`). `get_kind_guide` répond en texte : un plan du schéma (chaque champ sur une
   ligne, puis chaque type, actions et conditions une par ligne, formes legacy omises, `SchemaOutline`),
   les actions que déclarent les modules du serveur (`declared_actions`), l'écriture des textes par
   langue avec les langues du Project, et un exemple du Project (`KindGuide`) ; le schéma complet seulement avec `detail: "schema"`. Aucun outil ne déploie, ne supprime de Project, ne copie de modèle. Les
   seules actions de brouillon que le code MCP peut envoyer sont `list`, `read`, `create`, `update`
   (`McpProjects.DRAFT_ACTIONS`) ; un test d'architecture (`McpTest`) refuse toute autre action et
   tout nom de message qui écrit un disque dans les sources `Mcp*`. Le brouillon apparaît dans
   « Brouillons » de l'éditeur : le joueur relit le diff et clique Déployer. C'est le seul chemin
   vers le disque.
3. **Chaque fichier est vérifié par le serveur du Project avant d'entrer dans le brouillon.**
   Nouveau message `documents_check` (protocole 1.4, `DocumentCheck`, module `core`) : chemin
   (place d'un Document), YAML, **schéma JSON** du `schema:` (`docs/schema`, embarqués dans le jar,
   `$id` résolus depuis le classpath, jamais téléchargés), puis le `ProjectReader` du serveur sur
   une copie temporaire. Le schéma attrape ce que le lecteur tolère en silence (`tittle:`). La
   vérification tourne sur le serveur du Project, pas le hub : ses types de Documents (modules
   compris) et sa version. Tout le brouillon est vérifié comme un Project (une commande écrite
   avant un menu qui l'ouvre). Échec → l'outil rend `isError` avec les problèmes, le brouillon ne
   bouge pas. Serveur hors ligne ou plus ancien → refus explicite, pas d'écriture non vérifiée.
4. **OAuth 2.1, consentement dans l'éditeur.** Métadonnées RFC 9728
   (`/.well-known/oauth-protected-resource`) et RFC 8414 (`/.well-known/oauth-authorization-server`),
   enregistrement dynamique RFC 7591 (clients publics, `https` ou boucle locale), code + PKCE `S256`
   seul. `/oauth/authorize` renvoie vers la page `/oauth/consent` de l'éditeur, où le joueur est
   connecté comme d'habitude (`/artisan editor`) ; le client ne voit jamais le cookie. Un client
   inconnu ou une `redirect_uri` non enregistrée n'est jamais suivie. Code : 60 s, usage unique,
   brûlé par un mauvais vérificateur. Accès : 1 h ; rafraîchissement : 30 j, les deux tournent à
   chaque rafraîchissement. Tout est stocké **haché** (`artisan_mcp_clients`, `artisan_mcp_grants`).
5. **Un client agit comme le joueur, moins la publication.** Permissions de l'autorisation = celles
   du joueur moins `artisan.editor.publish` et `artisan.editor.config`, mises à jour par les rapports
   de permissions des serveurs (`Sessions.onPermissions`, comme les sessions). `/mcp` exige
   `artisan.editor.edit` à chaque appel (403 `insufficient_scope` sinon) ; sans `view`, l'autorisation
   est supprimée. L'autorisation est relue en base à chaque appel : une révocation (Réglages →
   Applications IA) agit au suivant, sur tous les serveurs d'une même base.
6. **Les routes MCP et OAuth sont `crossOrigin`.** Elles acceptent tout `Origin` (un client web comme
   MCP Inspector, CORS `*` sans identifiants) mais, appelées depuis une autre origine, elles ne
   reçoivent pas de session : le cookie n'agit jamais pour un autre site. Depuis l'éditeur lui-même
   (même origine), `/mcp` accepte la session : ce sera la porte de l'assistant intégré.
7. **Désactivé par défaut** (`web.mcp: false`) tant que c'est un aperçu.
8. **Déployer passe par la même vérification** (2026-10-26). `project_write` et
   `project_draft_publish` lancent `DocumentCheck` sur l'arbre qu'ils écriraient (renommages et
   suppressions compris, fichiers `.artisan*` exclus) avant tout compare-and-swap ; un échec répond
   `invalid_documents` (`message` : une ligne `chemin: problème` par problème, `problems` en liste),
   rien n'est écrit. Le hub le rend en 422 ; l'éditeur affiche les lignes dans la fenêtre d'échec de
   Déployer. Pour que les add-ons passent, le schéma accepte les actions qu'un serveur déclare : un nom
   préfixé (`guilds:rank_delete`) ou `module_command`/`cancel_event`, arguments non vérifiés. Un
   nom du cœur mal écrit reste refusé ; un nom préfixé mal écrit passe. Mesure préalable : les documents livrés avec
   MSGuilds, artisan-auctions et artisan-attribution passent tous (MSGuilds en comptait 90 avant la
   branche « déclarée », attribution 15). Un seul utilisateur d'Artisan à cette date : bloquer tout
   de suite plutôt qu'une phase d'avertissements.

## Conséquences

- Un joueur qui a `edit` peut confier ses brouillons à une IA ; le pire qu'elle fasse est un
  brouillon faux, qu'il ne déploie pas.
- Un déploiement qui écrirait un Document que le serveur ne chargerait pas est refusé en entier.
- Le protocole passe en 1.4. Une feuille plus ancienne ignore `documents_check` : `write_document`
  refuse sur ses Projects avec `plugin_update_required`.
- Le jar embarque `networknt/json-schema-validator` (relocalisé, SLF4J fourni par le serveur) et les
  schémas de `docs/schema`.
- L'enregistrement est ouvert à tous (c'est le principe du RFC 7591) : au-delà de 1 000 clients, ceux
  de plus d'une heure sans autorisation sont purgés ; un attaquant peut évincer un enregistrement
  en attente, pas une autorisation.

## Reporté

- Vérifier les actions préfixées et leurs arguments contre ce que le serveur déclare réellement
  (`guilds:rank_delet` passe aujourd'hui le schéma).
- Afficher les problèmes dans le diff de la revue de Déployer, avant le clic, plutôt qu'après.
- L'assistant cloud intégré, le portefeuille par serveur et le mode « fournisseur + clé de l'admin »
  (relais `/ai` du hub) : jalons suivants de la proposition.
- La détection de réutilisation d'un jeton de rafraîchissement (révoquer l'autorisation entière) :
  il faudrait garder les anciens hachages.
- Les outils d'images et de données (`write_blob`, sources de données) : pas avant que le flux texte
  ait servi.
