# Modèle d'entités & données

> Source de vérité du schéma : `backend/src/db/schema.ts` (+ migrations dans `backend/drizzle/`).
> Ce doc décrit le modèle **courant** puis l'historique des phases qui y ont mené.

## Versions (migration 0058)

`project_versions(id, project_id → projects cascade, hash, files, binaries, author_id →
users set null, created_at)` : un Snapshot reçu qui diffère de la Version précédente, écrit
dans la même transaction que `project_snapshots` (`putSnapshot`). `files` = manifeste chemin →
hash dans `snapshot_blobs` ; `author_id` `null` = le serveur. L'auteur vient de `noteAuthor`,
posé par `ServerProjectStorage` après une écriture réussie de l'éditeur, repris au Snapshot
suivant. Aucune purge. ADR `snapshot-mirror-and-backend-history`, décision 6.

## Miroir du Snapshot (migration 0056)

`project_snapshots(project_id PK → projects cascade, hash, files, binaries, failed,
received_at)` garde le dernier Snapshot reçu d'un Project serveur ; `files` est un manifeste
chemin → hash de contenu, les contenus vivent une fois dans `snapshot_blobs(hash, content)`
(partagés entre Projects, préparés pour les Versions). `hash` est l'empreinte opaque du
plugin. Clé = id **interne** (résolu par `getProjectForServer`). Jetable : jamais une
autorité ni une base de CAS. Les corps binaires restent dans le cache d'assets. Pas de GC des
blobs à ce stade. ADR `snapshot-mirror-and-backend-history`.

## Accès console (migration 0048)

`server_keys.editor_access_mode` conserve le dernier mode annoncé au hello
authentifié (`invitation` par défaut, ou `console`), même hors ligne. Dès qu'un
serveur du réseau active `console`, la page d'accès du réseau propose les
serveurs autorisants et remplace la demande d'accès par la commande console.
Les invitations manuelles restent possibles. `consoleAccess.ts` ajoute un compte
existant comme `member` sous verrou réseau, sans promotion d'un membre existant.
L'accès porte sur tout le Network, y compris ses autres serveurs/projets.

## Sessions de démo (migrations 0045–0047)

`projects` appartient soit à un Network, soit à une `demo_sessions` (`CHECK`
exclusif). Un projet invité reste `hosted`, sans faux compte/réseau/serveur.
`demo_sessions` stocke l'empreinte du cookie, l'expiration, un identifiant de
limitation haché et le journal de réclamation ; les fichiers/brouillons restent
dans une racine `demo_<id>` du volume hébergé. Le template commun est
`backend/src/templates/demo-project.json`, livré dans l'image backend et validé par le schéma éditeur.

Création et mutations prennent les verrous maintenance → budget global → session
→ racine. Seules les mutations effectives prolongent les 24 h ; une reprise du
même identifiant d'opération, lecture ou polling ne les renouvelle pas. L'activité
dans la révision active permet la reprise après activation FS puis rollback SQL.
Les limites incluent métadonnées, brouillons, historique, reçus et staging.

La réclamation journalise `claiming` avant le remappage des propriétaires de
brouillons, préserve IDs/révisions/binaires et conserve l'ID immuable du projet.
Le même compte reprend après perte du cookie via projet/opération. L'invité reste
révoqué ; une réclamation en cours ne subit jamais la purge TTL. Si le compte
perd l'accès au Network cible, il peut choisir une nouvelle cible autorisée avec
une nouvelle opération ; l'ancienne est auditée et renvoie `operation_superseded`.
Les racines réclamées ne consomment plus le budget invité et suivent le cycle
de sauvegarde/rétention des projets hébergés ordinaires.
Après révocation durable d'une démo expirée, ses métadonnées restent 24 h ;
la maintenance supprime ensuite projet/session et empreintes après nettoyage
physique confirmé. Un échec de nettoyage conserve le tombstone pour reprise.

## Copies hébergées vers Minecraft (migration 0044)

`project_copies` conserve l'opération, l'acteur, la révision source figée, le
serveur/Network/dossier destination, le manifeste avec tailles/digests et un
artefact borné immuable des octets publics. Ce journal n'est jamais une autorité
éditable : source hébergée et copie serveur restent indépendantes. Il exclut
brouillons privés et historique. L'artefact est retiré après activation vérifiée
ou échec terminal ; les reçus gardent l'idempotence.

Un verrou consultatif serveur partagé avec le renommage protège la réservation
insensible à la casse ; discovery et renommage respectent les copies `pending`.
Aucune ligne destination `projects` n'existe avant le reçu complet d'activation.
Une transaction crée l'ancre puis marque `completed`; `resource_pack_pending`
porte séparément le retry de reconstruction/push après commit SQL.
Cette reconstruction exige l'ancre destination, des arbres complets relus et les
tailles/SHA-256 des glyphes et textures de polices ; un ancien pack de secours ne
confirme jamais la copie. Les autres reconstructions gardent leur fallback existant.
Le Network courant de la clé est verrouillé et comparé à celui réservé : un
transfert pendant l'ACK laisse `target_moved`, sans ancre dans le mauvais Network.

Les identifiants d'acteur/source sont des références d'audit sans FK cascade :
supprimer un compte ou une source ne détruit pas un journal d'activation incertaine.
La maintenance authentifiée au serveur peut uniquement lire le reçu après révocation.
Un reçu activé termine l'ancrage ; une preuve expirée (ou manquante après 24 h)
libère artefact/réservation. Une activation inconnue hors ligne reste réservée
(maximum huit opérations par serveur), sans expiration aveugle ni ré-upload.

## Modèle courant (depuis 2026-06-03 — "Servers UX simplification")

**Renommage durable (migration 0040)** : `projects.identity_kind` est résolu par
le plugin (`folder`, `addon`, ou `unknown` avant négociation). `project_renames`
conserve opération, ancre, serveur, source, cible et état `pending/complete/failed`.
Les réservations actives sont uniques par ancre et cible insensible à la casse.
Un verrou transactionnel par serveur sérialise réservation, découverte et ACK ;
aucune transaction SQL n'attend une opération disque distante. L'ACK modifie
seulement `external_id` : brouillons privés, révisions et conversations
conservent leur ID interne ; les URLs suivent le nouvel ID de dossier. La migration Boutique suit la même règle de conservation.

**URLs de projet (2026-09-14)** : le segment `projects/:projectId` contient
`externalId ?? id`, sans normalisation ni slugification (`boutique_addon`).
`refs.ts` résout dans le serveur + Network, ou dans les projets hébergés du
Network ; la démo `/demo/projects/demo` utilise uniquement sa session courante.
Les IDs actuels sont prioritaires. Les anciens slugs, IDs internes et sources
de renommages terminés restent des alias, acceptés seulement sans ambiguïté.
Aucune migration SQL : `projects.slug` et ses index restent en lecture pour
ces liens historiques ; créations, copies, démos et backfill ne génèrent plus
de slugs de projet. Aucun ID interne, contenu ou lien de parenté n’est réécrit.

**Nom après renommage (2026-09-15)** : si `projects.name` correspond à l’ancien
ID de dossier, la confirmation du renommage met à jour les deux atomiquement,
sur stockage serveur comme hébergé. Un nom personnalisé distinct est conservé.
La migration 0049 répare les noms restés sur une source de renommage terminé,
y compris après plusieurs renommages ; add-ons et projets supprimés sont exclus.

**Localisation du Project (socle 2026-09-12, migration 0039)** : `projects.id`
reste l'ancre interne immuable. `storageKind` vaut `server` (défaut existant) ou
`hosted`. Un CHECK impose serveur non-null/racine hébergée null pour `server`,
et serveur null/racine privée non-vide/nom externe non-vide pour `hosted`.
Les IDs de dossier restent uniques par serveur ; les projets hébergés ont une
unicité par Network et une racine privée unique. Les FK Network et serveur
conservent leurs cascades ; supprimer un serveur ne supprime pas les projets hébergés.
La table `project_bindings` (ancien M:N) reste supprimée.

Le resolver autorise l'accès avant de sélectionner `ProjectStorage`. L'adaptateur
serveur reprend lectures, écritures CAS, binaires et historique existants ; la
publication d'un brouillon consomme ce même contrat. Le stockage hébergé durable
est implémenté en phase 4 ; les invités utilisent le même adaptateur en phase 6. Aucun mode ne
crée de faux serveur.

**Hébergement durable (migration 0043)** : `hosted_minecraft_version` décrit
l'environnement vanilla choisi, hors manifeste publié. `hosted_creation_fingerprint`
vérifie le retry d'une création idempotente ; aucun contenu n'y est stocké.
`project_renames.server_key_id` devient nullable et `hosted_network_id` réserve les
noms des projets hébergés ; un CHECK impose exactement une de ces deux portées.
Le journal et le service de renommage restent communs aux deux adaptateurs.
Les projets hébergés conservent leur racine opaque et ID interne immuables pendant
le déplacement réel de leur dossier logique dans une nouvelle révision.
Les fichiers et brouillons sont dans le volume `HOSTED_PROJECTS_DIR` : pointeur
atomique vers une révision complète, verrou PostgreSQL par racine partagé entre
workers, reçus idempotents privés. Le SQL ne contient aucune copie des binaires.
Les tombstones `deleted_draft_owners` déclenchent aussi la purge des brouillons
hébergés après commit. Les cascades Network rendent les racines orphelines ; la
maintenance les collecte après 24 h, sous verrou partagé avec la création.
Les racines explicitement supprimées sont retirées après 30 jours. Une racine
déjà retirée avec ancre supprimée est un état terminal, pas une erreur récurrente.
La [sauvegarde conjointe](../operations/hosted-storage-backup.md) capture PostgreSQL,
intentions de cycle de vie et volume sous verrous ; restauration avec workers arrêtés.
Le catalogue d'items hébergé exige la version sélectionnée exacte : si son fichier
est absent après restauration/déploiement, `/items` renvoie `404 unknown_version`
au lieu de substituer un autre patch. Le fallback des projets serveur est conservé.

`ProjectStorage.drafts` est lié au principal autorisé. `project_draft_storage`
(0041–0042) conserve l'autorité `backend/frozen/server` : gel durable, import des
enveloppes privées, relecture intégrale et vérification des blobs, puis basculement
et suppression des seules lignes `project_drafts` de ce Project. Un échec conserve
le gel et la source SQL ; reconnexion et maintenance minute reprennent l'opération.
Un ancien plugin garde l'autorité SQL ; un Project migré ne revient jamais en SQL.
Les reçus d'opérations legacy sont non modifiables pendant 24 h après migration,
puis leur contenu est effacé au profit d'un marqueur `operation_expired` empêchant
de rejouer une ancienne mutation. Aucun nouveau résultat serveur n'y est stocké.
`deleted_draft_owners` n'a aucune FK : la suppression de compte conserve cette
révocation après cascade Network/serveur. Chaque racine découverte reçoit une
purge du propriétaire, y compris les dossiers copiés. L'accès web est révoqué
immédiatement ; un serveur déconnecté applique la purge à sa reconnexion.

```
User ── Membership ──┐
                     ▼
                 Network (id, name, tier="free")
                   │ owns
       ┌───────────┼───────────┐
       ▼                       ▼
   ServerKey (1) ───────────► Project (N, first-class)
                              projects.serverKeyId (NOT NULL, FK cascade)
                              1 server_key → N projects

                              Project → ProjectBranch ← ProjectCommit  (DAG, branches + commits)
```

- **Project courant** : ancre immuable `id`, propriétaire `networkId` ou `demoSessionId`, localisation `storageKind` avec `serverKeyId` ou `hostedRootId`, puis `name`, `externalId`, `description`, `deletedAt`. Le contenu et les brouillons sont servis par `ProjectStorage` depuis le disque propriétaire ; `hash`/`filesJson` ne sont plus une autorité SQL éditable. Le modèle WIP/branches/commits décrit ci-dessous est historique (avant migration disk-only).
- **server_keys.networkId** NOT NULL. Créés depuis l'éditeur (`POST /networks/:id/server-keys`) au sein d'un Network existant. **`server_keys.hash` est nullable** : `NULL` = clé créée mais **pas encore redeemée** via `/artisan link` (aucun secret émis, ne s'authentifie jamais). Le secret est généré au **redeem** (`redeemLinkCode`, cf. `link_codes` + ADR `editor-first-server-linking`), jamais stocké en clair. Re-redeem d'un nouveau code = **rotation** du secret en place (même row). Cf. `rest-endpoints.md` § Link editor-first.
- **link_codes** (`code` PK, `serverKeyId` FK **ON DELETE CASCADE**, `expiresAt`, `claimedAt`) : code single-use TTL 10 min, minté par l'éditeur (create-server ou `.../link-code`), lié à un `server_key`. Supprimer la clé supprime ses codes (cascade).
- **IDs server_key** (`generateServerKey` dans `lib/auth.ts`) : row id = `srv_<hex>` (utilisé dans les URLs `/networks/.../servers/srv_xxx`), clé plaintext = `sk_<hex>` (renvoyée une seule fois par le redeem). Préfixes distincts volontairement pour ne pas confondre l'identifiant de ligne et le secret. Affichage UI via `displayServerLabel()`.
- **Assets** : plus de table ni de volume backend (ADR `assets-on-server-disk`, P6). Un asset est un fichier du Project sur le disque du serveur — `assets/{glyphs,textures,fonts}/…` — et son codepoint est proposé d'après ce que le disque porte déjà (`lib/codepoints.ts` pour la plage réservée).
- **`projects.externalId` = l'id disque, unique PAR SERVEUR** (migration 0029, unique `(server_key_id, external_id)`) : `id` reste la clé interne globale que pointent toutes les FK, `externalId` est le seul id **plugin-facing** (nom du dossier sur disque, `project_id` sur le fil, URL `/api/v1/bundles/:id`). Les deux ne divergent que si un autre serveur détenait déjà cet id disque ; sinon `externalId == id`, et le backfill l'a posé ainsi pour toutes les lignes existantes.
  - **Pourquoi** : un id disque n'est pas unique — l'add-on Boutique bootstrappe `boutique_shop` sur *chaque* serveur qui l'installe. Les trois points d'ingestion résolvaient par id seul et sans contrôle de propriétaire, donc le push d'un serveur atterrissait dans le project d'un autre **tenant** ; `createProject` étant idempotent sur l'id (anti-crash 2026-07-09), la collision était silencieuse au lieu de lever un duplicate-key. Écrasement cross-tenant reproductible par le flow de liaison normal (incident 2026-08-12).
  - **Règle** : tout code qui tient une clé serveur résout par `getProjectForServer(serverKeyId, diskId)` / `ensureProjectForServer(...)`, **jamais** `getProject(id)`. `getProject` reste réservé aux chemins éditeur, dont l'id vient d'une URL déjà autorisée par membership.
- **WS hub** : `hello_ack.project_hashes` et `pushBundleAvailable(projectId, hash)` résolvent les targets via `projects.serverKeyId`. `pushProjectDeleted(projectId)` idem. Tous traduisent l'id interne → `externalId` **avant** d'écrire sur le fil, et `computeAllPacksHash` keye sur l'id disque (sinon `needs_sync` reste vrai à jamais pour un project renommé en interne).

### Branches + commits (DAG)

- **project_commits** : `(id, projectId, parentId, parentId2?, contentHash, filesJson, authorUserId, message, createdAt)` — files-first : plus de colonne `editor_json`, le contenu d'un commit EST son arbre de fichiers. Snapshot complet par commit. Dedup par `(projectId, contentHash)`. `parentId` nullable pour le commit racine (auto-créé à `createProject`). `parentId2` = 2ᵉ parent des merge commits (colonne conservée mais **plus aucun merge commit créé** depuis le retrait du merge 3-way le 2026-06-17 — cf. ADR `no-branch-conflict-resolution`), `null` sur les commits linéaires.
- **project_branches** : `(projectId, name, headCommitId, createdAt, updatedAt)`. Unique par `(projectId, name)`. V1 : toujours `"main"` (pas d'UI branches).
- **WIP vs commit** : les plugins lisent **uniquement les commits** via `project_branches.headCommitId` → `project_commits.filesJson`. Le WIP (`projects.filesJson`) est le buffer éditeur.
- **Concurrence optimiste sur le WIP (2026-07-06)** : `projects.version` (int, default 0) est incrémenté par **chaque** écriture de contenu (`upsertProjectContent` — save éditeur, `local_push` plugin, deploy). Les PUT éditeur (`user/projects/:projectId` et `editor-session/:token/projects/:projectId`) exigent la version chargée (`baseVersion`/`base_version`) et répondent `409 version_conflict` si elle a bougé — empêche l'écrasement muet entre deux onglets/admins (zombie writer). Le push plugin n'a pas de précondition (arbitré par le système de conflits hash) mais incrémente, ce qui invalide les onglets ouverts. Côté éditeur : `projectVersionStore` (hors zundo), auto-save suspendu + bannière reload sur conflit.
- **LCA** : `branchStorage.findLCA(a, b)` — BFS bidirectionnel borné à 10 000 steps, walk `parentId` + `parentId2`.

### Branches — modèle linéaire (FF-only)

- **Pas de merge 3-way ni de résolution de conflits.** Le moteur `mergeEngine` + les endpoints `merge-into`/`resolve` ont été retirés le 2026-06-17 (cf. ADR `no-branch-conflict-resolution`) : aucune UI ne les câblait, et la concurrence live est déjà gérée par LWW + présence (`decisions/editor-state-model.md`). Quand les branches reviendront (dev→prod), le flux sera *fast-forward only* (`promote/:dst`). Primitives DAG conservées mais inertes : `project_commits.parentId2`, `branchStorage.findLCA`.
- **`canvasLayout`** (`Record<id, {x,y}>`, métadonnée éditeur) : depuis 2026-06-13 c'est l'**ensemble d'appartenance à la planche** (présence d'une entrée = le Document est sur la planche curée), pas seulement des positions sauvegardées. Pas de changement de schéma DB — seule la sémantique évolue ; `autoLayout` côté éditeur ne retourne que les entrées explicites. Détail : `editor-internals.md` (§ Planche curée).

**Brouillons de Project (2026-09-11, migration 0037)** : `project_drafts` porte
`id`, `project_id`, `owner_id`, `name`, `revision`, `status`, `snapshot`,
`updated_by`, `source`, dates. Le Project détermine réseau et serveur ; les FK
suppriment les brouillons avec le Project ou le propriétaire. Plusieurs brouillons
privés par utilisateur/Project sont permis. `snapshot` contient base, arbre,
arbre initial, date de base et renommages. Chaque mutation exige la révision
attendue ; publication et écriture concurrente sont sérialisées par verrou de ligne.
Les états sont `active`, `published`, `discarded` ; les états terminaux restent
consultables, sans être repris par la liste active. `source` vaut `editor` pour
l'API actuelle. Le MCP et ses autorisations déléguées restent à implémenter.

**Retour des brouillons serveur dans le backend (2026-09-26, migration 0057)** :
`project_draft_blobs(draft_id → project_drafts cascade, hash, content bytea)` garde les
images **modifiées** d'un brouillon ; une image identique à la base publiée n'a pas
d'octets privés. `project_draft_storage.state` gagne `returning` : `resumeServerDrafts`
(au `hello`, au démarrage, à la maintenance) rapatrie les Projects à l'état `server`
— gel `returning`, `list_all` + `read_blob` vérifiés, insertion et bascule `backend`
en une transaction. Un ancien gel `frozen` repasse `backend` sans le plugin (la copie
SQL n'avait jamais été retirée). Les brouillons d'un auteur disparu ne reviennent pas.
Les copies `.artisan/drafts/` restent sur le disque, jamais relues ; celles des comptes
supprimés sont toujours purgées (`purge_owner`). ADR `snapshot-mirror-and-backend-history`.

## Auth & comptes

- **Account deletion** (migration 0038): `account_deletion_tokens` stores one token per User, its SHA-256 hash, the confirmed email, creation time and 30-minute expiry. Resends replace the token after a one-minute cooldown. Confirmation consumes the token and deletes data in one transaction; failure rolls back consumption. Email changes invalidate the link. User deletion cascades sessions, OAuth links and private drafts; explicit cleanup removes personal assistant conversations/uploads/tasks, invitations and transfers, and scrubs usage previews and nullable audit references.
- Networks losing their last manager (`owner` or legacy `admin`) are deleted with their server/project references, under the same advisory locks as membership management. Other networks remain. Active subscriptions block this teardown until cancelled. Plugin credentials are disconnected after commit; no file-deletion message is emitted. Minecraft files remain available for relinking.


- Tables : `users`, `user_sessions`, `oauth_accounts`, `password_reset_tokens`. Migration 0034 copies existing `discord_accounts` links to `oauth_accounts`; the old table is retained as history and no longer written.
- `oauth_accounts`: primary key `(provider, subject)`, unique `(provider, user_id)`, cascading FK to `users`. Google uses its verified ID-token `sub`; Discord uses its user ID. An existing identity always resolves to the original User, even after an email change. No access/refresh tokens are stored.
- First Google login links an existing normalized email only when `email_verified=true` and Google is authoritative (Gmail or Workspace `hd`). External Google addresses may create a new User but cannot automatically claim an existing email. New Discord links require `verified=true`. Matching leaves password, name, preferences and memberships intact. Transactions lock identity then email to avoid duplicate accounts under concurrent callbacks; a different identity for an already-linked provider is rejected.
- Google flow: signed HttpOnly cookie `artisan_google_oauth` (10 minutes, Secure in production), state + nonce + PKCE S256. `jose` checks RS256 signature, issuer, audience, expiry and required claims; nonce and authorized party are checked before resolving the User. Successful login uses the existing `artisan_user_session` cookie; failures return to `/login?oauth_error=…`.
- Cookies : `artisan_user_session` (HttpOnly, 30j → `user_sessions.id`), `artisan_oauth_state` (HttpOnly, 10min, anti-CSRF Discord).
- **`password_reset_tokens`** (migration 0028) : `(id PK, user_id FK cascade, token_hash UNIQUE, expires_at, used_at, created_at)`. Seul le **SHA-256** du token envoyé par email est stocké — un dump DB ne donne aucun lien utilisable. TTL 1 h. Consommation atomique (`UPDATE … WHERE used_at IS NULL AND expires_at > now() RETURNING`, `lib/passwordResetStorage.ts`) → single-use même sous double soumission. Un reset réussi détruit **toutes** les sessions du user (`destroyUserSessions`) et invalide ses autres tokens en attente. Un compte Discord-only (`password_hash` NULL) peut se **définir** un mot de passe par ce flux. Pas de rate-limiting sur `POST /auth/forgot-password` (même dette que `invites/accept`).
- **Accounts-only** (accounts-only cutover, Task 7) : la table `editor_sessions` (trust dance anonyme server_key + token URL) a été **DROP**pée (migration `0018_colossal_spectrum.sql`). L'édition est désormais exclusivement authentifiée par compte user — cf. `docs/decisions/accounts-only-editing.md`.
- **`users.editor_language`** (TEXT nullable) : langue UI préférée. Source de vérité client = `localStorage["i18nextLng"]`. Logged-in : `authStore.hydrate()` lit depuis `GET /me` au boot (backend wins) ; changement via `EditorLangSwitcher` → PATCH fire-and-forget. Anonymous → localStorage only.
- **`users.editor_tour`** (JSONB nullable, migration 0051) : `null` signifie jamais présenté ; `{step: 0..6, completed: boolean}` conserve l'accueil (0), la dernière étape ou l'achèvement (6). État du compte commun à tous les projets/appareils, y compris en démo. Démarrage et import invité sont atomiques et ne s'appliquent qu'à `null` ; une visite terminée le reste même pendant une relance manuelle. Le suivi invité reste dans le navigateur ; son import exige le retour corrélé d'une authentification lancée explicitement depuis la démo. Abandonner ce parcours supprime l'intention de transfert.
- **`users.is_admin`** (BOOLEAN, default `false` — migration 0006) : flag super-admin plateforme. Amorçage env `ADMIN_BOOTSTRAP_EMAILS` (CSV) dans `userAuth` : un user dont l'email est listé est promu à sa prochaine requête authentifiée (write DB une seule fois, guard `!isAdmin` ; couvre login/signup/Discord). Exposé dans `GET /me`. Garde middleware `requireAdmin()` (403 si non-admin ; à câbler aux routes admin en plan 2).

## Super-admin & config plateforme

- **`app_settings`** (migration 0006) : store générique key/value plateforme-wide. `(key PK, value TEXT — JSON stringifié, updated_at, updated_by → users.id)`. Usage prévu : config de l'assistant IA gérée par le super-admin. Les secrets dans `value` sont chiffrés via `secretBox` (AES-256-GCM, clé `CONFIG_ENC_KEY`) avant stockage ; `isSecretsConfigured()` gate le fallback env quand la clé n'est pas configurée. Pas d'endpoint/UI au plan 1 (socle) — branchés aux plans 2 (config IA backend) & 3 (UI `/admin`).

## Assistant IA — conversations

- **Uploads (migration 0036)** : `assistant_conversations.uploaded_files` JSONB nullable contient `{networkId, serverKeyId, files: {filename: text}}`. Stockage privé, séparé du transcript et absent des DTO publics ; les lectures par outil sont reconstruites à chaque tour autorisé. Une suppression de conversation supprime donc ses uploads sans blob externe. Un changement de portée interdit leur réutilisation. Limites : 200 fichiers, 1 MiB par fichier, 8 MiB JSON cumulé. Les sources serveur restent uniquement référencées, jamais copiées ici.

- **`assistant_tasks`** (migration 0035) : exécution serveur d'un message, liée par FK à la conversation. Stocke `request_id`, empreinte de requête, message, statut, dates et événements dérivés (activité, texte, raisonnement fourni par le modèle, propositions). Unicité requête/conversation et index partiel garantissant une seule tâche active. La portée réseau/serveur et le hash de base du brouillon sont dans l'événement d'acceptation. Aucune working-copy complète ni copie des sources serveur brutes n'est persistée. La déconnexion du navigateur ne termine pas l'exécution ; un processus serveur perdu exige une intervention explicite.

- **`assistant_conversations`** (migration 0007) : historique du chat assistant, scopé par `(owner_key, project_id)` (index `assistant_conv_owner_project_idx`). `(id PK, owner_key TEXT, project_id TEXT, title TEXT, messages JSONB — transcript LLM complet pour la reprise, created_at, updated_at)`. `owner_key` = `sk:<serverKeyId>` (session plugin) ou `user:<userId>` (login web), miroir de `resolveOwnerKey` (`modules/assistant/routes.ts`). La working-copy n'est **pas** persistée (reconstruite depuis le project vivant à chaque tour). `title` dérivé du 1er message utilisateur. Pas de FK sur `project_id`/`owner_key` — des conversations orphelines sont tolérées si le project est supprimé.

## AI models & credits (2026-07-02)

- **`ai_models`** — catalogue admin des modèles IA (prix credits + coût réel micro-USD par 1M tokens, badge cheap/balanced/premium, `is_default` unique via index partiel). Jamais supprimés, seulement désactivés.
- **`ai_usage_log`** — une row par tour d'assistant : acteur (`user_id` ou `server_key_id`), `network_id` (porteur du débit), snapshots modèle, tokens, `credits_charged` (0 si `status='error'`), `real_cost_micro_usd`, `prompt_preview` (~200 chars — contenu complet dans `assistant_conversations`).
- **`ai_credit_ledger`** — solde d'un network = `SUM(delta)`. `reason ∈ {grant, debit, refund, adjustment}` ; les débits pointent `usage_log_id`. Le **network** porte les credits (décision spec 2026-07-02) : sessions user ET server-key débitent le network du project.
- **Buckets de credits (2026-07-03)** — `ai_credit_ledger` porte `bucket` (`subscription`/`rollover`/`topup`), `expires_at` (bucket subscription expire en fin de période), `period_id`. Solde d'un bucket = `SUM(delta)` non expiré. Débit dans l'ordre subscription → rollover → topup. `renewSubscriptionPeriod` (backend) auto-roule le solde restant (period-scoped, via `period_id`) du bucket subscription vers rollover, plafonné à `rollover_cap`. Les débits d'un bucket subscription héritent de l'`expires_at`/`period_id` du grant qu'ils consomment (`debitBuckets`), pour que grant et débits sortent ensemble de la SUM non-expirée. Spec `2026-07-03-billing-subscriptions-topups-design.md`.
- `users.preferred_ai_model_id` — dernier modèle choisi (pas de FK, fallback silencieux sur le défaut si dangling).

## Invitations (`network_invites`, 2026-07-12)

- **`network_invites`** : `(id "inv_"+rand, network_id FK cascade, role TEXT défaut "member", code TEXT unique — format `generateCode()` partagé avec `link_codes`, email nullable, max_uses INT nullable — null = illimité, used_count INT défaut 0, expires_at, revoked_at nullable, created_by → users.id, created_at)`. Lib `backend/src/lib/inviteStorage.ts`.
- **Statut dérivé** (`inviteStatus`, jamais stocké) : priorité `revoked` > `expired` > `exhausted` (`used_count >= max_uses` quand `max_uses` non-null) > `valid`. `now` injectable pour les tests.
- **`acceptInvite(code, userId)`** : code inconnu → `{error: "not_found"}` ; statut ≠ valid → `{error: status}` ; user déjà membre du network → `{networkId, alreadyMember: true}` **sans** incrémenter `used_count` (idempotent, pas de double-consommation) ; sinon `addMembership(userId, networkId, invite.role)` (`membershipManager`) + `used_count += 1`.
- **`listInvites`** : non-révoquées d'abord, puis plus récent d'abord (tri sur `revoked_at IS NOT NULL`, puis `created_at DESC`).

## Access requests (`network_access_requests`, 2026-07-13)

- **`network_access_requests`** : `(id "acr_"+rand, network_id FK cascade, user_id FK cascade, message TEXT nullable — cap 500 côté route, status TEXT défaut "pending" ∈ {pending, approved, denied}, resolved_by nullable, created_at, resolved_at nullable)`. Lib `backend/src/lib/accessRequestStorage.ts`. Pas d'index unique partiel en drizzle simple — unicité pending appliquée en code (`createRequest` refuse un 2ᵉ `pending` pour `(user_id, network_id)` → `{error: "already_pending"}`).
- **`createRequest`** : refuse si une row `pending` existe déjà pour la paire ; sinon insère et retourne la row.
- **`listRequests`** : pending d'abord, puis plus récent d'abord (tri sur `status <> 'pending'`, puis `created_at DESC`) — miroir de `listInvites`.
- **`resolveRequest(requestId, {approve, resolvedBy})`** : row absente ou déjà résolue → `{error: "not_pending"}` ; `approve: true` → `addMembership(userId, networkId, "member")` (catch Postgres 23505 = déjà membre, toléré, la request est quand même marquée `approved`) ; sinon `status="denied"`. Toujours `resolved_at`/`resolved_by` posés.
- **Flux** : `POST /api/v1/networks/:idOrSlug/access-requests` (non-membre, cf. `rest-endpoints.md`) crée la request et envoie `accessRequestEmail` (fire-and-forget `sendSafely`) à chaque membre `manage_members`-capable du network.

## Transferts & désaffectation

- **`network_transfers`** : `(token, network_id, initiated_by_user_id, expires_at, consumed_at, consumed_by_user_id, created_at)`. Token partageable 24h pour transférer la propriété d'un Network entier. Memberships swap **clean break** — ancien owner perd l'accès.
- **Server key deletion** : DELETE server_key (owner-only) → cascade les projects liés (`projects.serverKeyId` FK cascade). Le plugin perd la connexion au prochain hello.
- **Désaffectation sans transfert** : delete la server_key, re-setup côté plugin → l'auto-push (`local_push` au hello) recharge les projects dans le nouveau network. Pas de mutation cross-account.
- **Bootstrap d'identité** : au hello, un project présent sur le disque du serveur mais inconnu du backend y est enregistré — **identité seulement**, aucun contenu (ADR `server-disk-only-storage`).

## Custom items cache

Cache disque : `backend/data/custom-items/{server_key_id}/{hash.txt, items.json, textures/}`. Peuplé par le plugin via WS `custom_items_bundle`.

**Invariant hash** : `CustomItemsManager.buildBundle()` calcule le hash inline depuis les items/textures déjà collectés (ne rappelle pas `computeHash()` séparément) — cohérence hash ↔ data.

## Présence des modules (`server_modules`)

`server_modules(server_key_id, module_id, version, last_seen)` — ensemble des modules actifs par serveur, **remplacé à chaque `hello`** depuis `installed_modules` (upsert + prune dans `persistServerModules`, `hub.ts`). PK composite `(server_key_id, module_id)`, FK → `server_keys` cascade. **Présence uniquement** : pilote la visibilité des modules dans l'éditeur ; cacher un module (retirer la ligne) **ne supprime jamais** le contenu authored (qui vit dans `projects`/etc.). Cf. `docs/superpowers/specs/2026-06-15-modules-architecture-design.md` §8.

## Data sources reportées (`server_data_sources`)

`server_data_sources(server_key_id, ref, schema_hint, module_id, schema_json, stability, key_field, reported_at)` — mêmes sémantique et mécanique que `server_modules` : **remplacé à chaque `hello`/`modules_changed`** depuis `data_sources` (upsert + prune dans `persistServerDataSources`, `hub.ts`). PK composite `(server_key_id, ref)`, FK → `server_keys` cascade. **Présence uniquement**, sert le sélecteur de source du menu côté éditeur (`GET /api/v1/networks/:networkId/servers/:serverId/data-sources`, cookie auth + membership) ; un `ref` peut pointer vers une source qui n'existe plus (invariant hermétique — l'éditeur ne bloque jamais sur un ref inconnu). Nouveaux champs (Task 2, 2026-07-14) : `module_id` (texte, null = core/tiers directs) — module propriétaire signalé au hello ; `schema_json` (texte JSON, null = non déclaré) — schéma typé `{name, type, description}[]` signalé au hello, reparse en tableau plat à la lecture (`parseSchemaJson`, tolerant aux nulls/corruptions). Nouveaux champs (2026-07-15, **migration 0024**) : `stability` (texte, `"static"`/`"dynamic"`, null = legacy) — axe déclaré par le module ; `key_field` (texte, null sauf source statique) — champ Row key d'une source statique, sur lequel les Placements de menu s'ancrent (cf. `CONTEXT.md` Data source / Row key / Placement).

## Config screens reportés (`server_editor_screens`, migration 0027)

`server_editor_screens(server_key_id, screen_id, screen_json, reported_at)` — **présence uniquement**, même mécanique que `server_data_sources` / `server_declared_models` : remplacé à chaque `hello`/`modules_changed` depuis `editor_screens` (upsert + prune dans `persistServerEditorScreens`, `hub.ts`). PK composite `(server_key_id, screen_id)`, FK → `server_keys` cascade. `screen_json` = la déclaration verbatim `{id, module_id, label, table, project_id}` (ADR `module-config-screens` §2), servie à l'éditeur par `GET …/servers/:sid/screens`. Les **contenus** édités par ces écrans ne sont jamais stockés ici : la lecture/écriture est live via le relais WS `config_read`/`config_write` (§3 — le backend relaie sans stocker).

## Assistant migration checkpoints (2026-09-07, migration 0032)

- Migration 0033 adds private `assistant_migration_steps.continuation` JSON: replayable tool references, assistant history/summary, inspected source ranges, limitations and explicit compression flags. Raw read/search/reference payloads are rebuilt from hash-verified sources, not copied into the checkpoint. Summaries and assistant-generated text are derived content and may quote sources. The checkpoint is not exposed by run APIs and is cleared on step completion; deletion follows the existing step cascade.
- `budget.contextTokens` is legacy metadata, no longer enforced; new runs store null. A provider context rejection pauses without auto-compression. Explicit compression saves its summary and debits usage atomically under the step lease before continuation. Failed compression preserves the previous state; a later retry reuses a successfully saved summary.

- `assistant_migration_runs` stores owner/conversation/Project/network/server/model identity, source manifest (paths and hashes only), context/output limits and credit usage, revision and status. No raw zMenu contents or Project working copy is stored. `(conversation_id, request_id)` is unique; a different request fingerprint cannot reuse that ID.
- `assistant_migration_steps` reserves stable source/target IDs and a renewable 90-second fenced lease. `assistant_migration_proposals` contains only derived assistant output (one per step). Both cascade with the run; runs cascade on conversation, Project, network or server deletion. An inaccessible or soft-deleted Project cannot be resumed.
- `assistant_migration_events` has a monotone per-run sequence, controlled event/code fields and paginated reads. Storage guards limit manifests to 200 entries/1 MiB, proposals to 1 MiB each, retries to 10 per step and control events to 10,000 (terminal cleanup can add a bounded final event). Run-row transactions serialize claims, revision changes and checkpoints across processes. Expired step leases and orphan dispatches (90 seconds without a step after start/checkpoint) become paused; recovery never invokes the provider. Resume is explicit.
- Success commits proposal, usage, credit debit, step completion and event in one transaction. `ai_usage_log.idempotency_key` is unique; replay does not debit again. Failure usage is logged once per fenced attempt without debit or raw source preview. Provider-side consumption before a crash is not guaranteed exactly once.
- Pause/cancel prevents the next claim; a live in-flight step may still checkpoint and be charged. The last completed step completes even a paused run; a cancelled run remains cancelled while retaining its result. The selected model ID is fixed; each step uses its active catalog prices, without model fallback. There is no migration-specific credit cap (legacy JSON caps are ignored; new runs store null). Network balance and administrator per-turn limits remain, with possible in-flight overshoot. Applying proposals only changes the browser draft: explicit **Save** remains the only Project publication.

## Billing (2026-07-03)

- **Public presentation (2026-09-22)** — `subscription_plans.description` defaults to `""` (admin input capped at 240 characters), `highlighted` defaults to `false`. Existing `features` remains newline-delimited text; `sort_order` defines display order, with ID as stable tie-breaker. Presentation edits do not recreate Stripe prices. Migration `0050` adds only the two defaulted columns.

- **`credit_packs`** / **`subscription_plans`** — catalogue admin des top-ups et formules, provisionnés en products/prices Stripe (`stripe_product_id`/`stripe_price_id`). Prix en cents. Pack : credits accordés = `credits + round(credits*bonus_pct/100)`. Les formules exposent au catalogue public `description`, `features`, `highlighted` et `sort_order` ; les champs de présentation ne modifient pas les prix Stripe.
- **`network_billing`** — état de facturation par network (`stripe_customer_id`, `stripe_subscription_id`, `plan_id`, `status`, `current_period_end`, `grace_until`, `current_period_id`, `credit_cycle_start`, `credit_month_index`). `networks.tier` = flag dénormalisé. `current_period_id` = periodId de la période de crédits courante, pour le rollover. Migration `0055` : les deux derniers champs ancrent les versements mensuels d'un Pro facturé à l'année.
- **Crédits Pro annuels** — `invoice.paid` confirme l'année payée et attribue les 500 premiers crédits jusqu'à la prochaine borne mensuelle. `annualProCredits` attribue 500 crédits chaque mois suivant, jusqu'à la fin de l'année payée ; une transaction verrouille `network_billing` et avance `credit_month_index` pour éviter tout doublon au redémarrage ou entre workers. Les mois manqués pendant une interruption ne sont pas cumulés : seul le mois courant est attribué à la reprise. Un abonnement mensuel continue à recevoir ses crédits via chaque facture payée.
- **Accès éditeur Pro** — `subscription_plans.editor_pro` marque les offres Pro. `network_billing.paid_through` et `paid_editor_pro` sont confirmés ensemble par `invoice.paid` ; `subscription.updated` ne prolonge jamais ces droits. Un changement de plan via Stripe est résolu par l'identifiant de Product sur l'abonnement puis sur la facture. Une facture d'upgrade mensuel au milieu d'une période peut accorder Pro sans renouveler les crédits IA ; si elle active Pro annuel, elle démarre le cycle de crédits mensuel. Le Network conserve Pro jusqu'à `paid_through`, même après annulation ; un nouveau plan ne reçoit aucun droit avant son paiement. Les migrations 0052–0054 ajoutent aussi `billing_config_audit` pour les changements de formule et de quota.
- **Limites commerciales** — Free : 10 ressources personnelles par serveur, 2 serveurs par Network, 2 collaborateurs en plus d'un owner (un co-owner compte comme collaborateur). Pro : 250 ressources personnelles par serveur, 10 serveurs, collaborateurs illimités. Les ressources fournies par les modules sont hors quota. La création de serveur et l'ajout de membre utilisent un verrou transactionnel par Network ; l'expiration de Pro conserve serveurs et membres existants, mais bloque les ajouts au-delà des limites Free. La publication des ressources dépend du `editor_commercial_policy.enforcementEnabled` administrable.
- **`credit_purchases`** — audit des top-ups (historique §1.3) ; l'URL de facture pointe Stripe.
- **`stripe_events`** — idempotence des webhooks (`event_id` PK) : `handleStripeEvent` claim l'`event_id` (insert-on-conflict-do-nothing) avant tout fulfillment ; un event rejoué est ignoré. `network_billing.status`/`current_period_id`/`grace_until` sont pilotés par ces webhooks (`invoice.paid`, `payment_failed`, `subscription.updated/deleted`).

---

## Historique des phases (récit — pas la référence courante)

L'évolution qui a mené au modèle ci-dessus. Conservé pour comprendre les migrations.

- **Plan 1A — accounts foundation** : `users`, `user_sessions`, `discord_accounts`.
- **Plan 1B — multi-server networks** : Project devient first-class (plus de scope par `server_key`). Tables ajoutées : `networks`, `memberships`, `projects`, ~~`project_bindings`~~. Table supprimée : `project_bundles` (fusionnée dans `projects`). Le **M:N `project_bindings`** (un project ↔ N server_keys) a existé ici **puis a été supprimé en 2026-06-03** au profit du 1:N. (Ces tables étaient nommées `pack*` avant le renommage `pack`→`project` de 2026-06-18.)
- **Phase 2 — branches + commits** : tables `project_commits`, `project_branches`. (À l'époque, `project_bindings.branchName` ciblait une branche ; disparu avec `project_bindings`.)
- **Phase 3 — merge sémantique par item** : column `project_commits.parentId2` (DAG / LCA).
- **Accounts × networks UX** : claim login-required + smart-count, `network_transfers`, rotation/audit/allowlist server_key.
- **Servers UX simplification (2026-06-03)** : M:N → 1:N (`project_bindings` supprimée, `projects.serverKeyId` NOT NULL). UI branches retirée (toujours `"main"` backend) → onglet History + Restore par commit. Sync multi-serveur = V2 hors-scope. Spec : `docs/superpowers/specs/2026-06-03-servers-ux-simplification-design.md`.
