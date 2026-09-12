# Modèle d'entités & données

> Source de vérité du schéma : `backend/src/db/schema.ts` (+ migrations dans `backend/drizzle/`).
> Ce doc décrit le modèle **courant** puis l'historique des phases qui y ont mené.

## Modèle courant (depuis 2026-06-03 — "Servers UX simplification")

**1 project = 1 server_key** (relation **1:N**). `projects.serverKeyId` est NOT NULL avec FK cascade vers `server_keys.id`. La table `project_bindings` (ancien M:N) a été supprimée.

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

- **Project** : entité first-class — `id`, `networkId`, `serverKeyId`, `name`, `externalId`, `description`, `hash`, `filesJson`, `deletedAt`. `filesJson`/`hash` = buffer éditeur **WIP** live. **Files-first (P3a, 2026-07-24)** : l'arbre de fichiers est la **seule** représentation stockée (ADR `files-first-source-of-truth`) — les colonnes `editor_json`/`deployed_editor_json` ont été droppées (migration 0025) ; l'éditeur parse `files` → domaine au load (`editor/src/schema/projectFromFiles.ts`) et sérialise domaine → `files` au save (`transform.ts`).
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

- **`credit_packs`** / **`subscription_plans`** — catalogue admin des top-ups et formules, provisionnés en products/prices Stripe (`stripe_product_id`/`stripe_price_id`). Prix en cents. Pack : credits accordés = `credits + round(credits*bonus_pct/100)`.
- **`network_billing`** — état de facturation par network (`stripe_customer_id`, `stripe_subscription_id`, `plan_id`, `status`, `current_period_end`, `grace_until`, `current_period_id`). `networks.tier` = flag dénormalisé. `current_period_id` = periodId de la période d'abo courante, pour le rollover au renouvellement.
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
