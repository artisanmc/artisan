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

- **Project** : entité first-class — `id`, `networkId`, `serverKeyId`, `name`, `description`, `hash`, `filesJson`, `editorJson`, `deployedEditorJson`, `deletedAt`. `filesJson`/`editorJson`/`hash` = buffer éditeur **WIP** live.
- **server_keys.networkId** NOT NULL. À la création (claim / `/api/server-keys` / WS `setup_claim`), un Network par défaut `Network <prefix>` est auto-créé.
- **IDs server_key** (`generateServerKey` dans `lib/auth.ts`) : row id = `srv_<hex>` (utilisé dans les URLs `/networks/.../servers/srv_xxx`), clé plaintext = `sk_<hex>` (montrée une seule fois). Préfixes distincts volontairement pour ne pas confondre l'identifiant de ligne et le secret. Affichage UI via `displayServerLabel()`.
- **Assets per-project** : `assets.projectId`, codepoint allocator scopé au project, disque `data/assets/{projectId}/...`.
- **WS hub** : `hello_ack.project_hashes` et `pushBundleAvailable(projectId, hash)` résolvent les targets via `projects.serverKeyId`. `pushProjectDeleted(projectId)` idem.

### Branches + commits (DAG)

- **project_commits** : `(id, projectId, parentId, parentId2?, contentHash, filesJson, editorJson, authorUserId, message, createdAt)`. Snapshot complet par commit. Dedup par `(projectId, contentHash)`. `parentId` nullable pour le commit racine (auto-créé à `createProject`). `parentId2` = 2ᵉ parent des merge commits (colonne conservée mais **plus aucun merge commit créé** depuis le retrait du merge 3-way le 2026-06-17 — cf. ADR `no-branch-conflict-resolution`), `null` sur les commits linéaires.
- **project_branches** : `(projectId, name, headCommitId, createdAt, updatedAt)`. Unique par `(projectId, name)`. V1 : toujours `"main"` (pas d'UI branches).
- **WIP vs commit** : les plugins lisent **uniquement les commits** via `project_branches.headCommitId` → `project_commits.filesJson`. Le WIP (`projects.filesJson`) est le buffer éditeur.
- **LCA** : `branchStorage.findLCA(a, b)` — BFS bidirectionnel borné à 10 000 steps, walk `parentId` + `parentId2`.

### Branches — modèle linéaire (FF-only)

- **Pas de merge 3-way ni de résolution de conflits.** Le moteur `mergeEngine` + les endpoints `merge-into`/`resolve` ont été retirés le 2026-06-17 (cf. ADR `no-branch-conflict-resolution`) : aucune UI ne les câblait, et la concurrence live est déjà gérée par LWW + présence (`decisions/editor-state-model.md`). Quand les branches reviendront (dev→prod), le flux sera *fast-forward only* (`promote/:dst`). Primitives DAG conservées mais inertes : `project_commits.parentId2`, `branchStorage.findLCA`.
- **`canvasLayout`** (`Record<id, {x,y}>`, métadonnée éditeur) : depuis 2026-06-13 c'est l'**ensemble d'appartenance à la planche** (présence d'une entrée = le Document est sur la planche curée), pas seulement des positions sauvegardées. Pas de changement de schéma DB — seule la sémantique évolue ; `autoLayout` côté éditeur ne retourne que les entrées explicites. Détail : `editor-internals.md` (§ Planche curée).

## Auth & comptes

- Tables : `users`, `user_sessions`, `discord_accounts`.
- Cookies : `artisan_user_session` (HttpOnly, 30j → `user_sessions.id`), `artisan_oauth_state` (HttpOnly, 10min, anti-CSRF Discord).
- Distinct du flow trust dance (server_keys + editor_sessions) — les deux cookies coexistent.
- **`users.editor_language`** (TEXT nullable) : langue UI préférée. Source de vérité client = `localStorage["i18nextLng"]`. Logged-in : `authStore.hydrate()` lit depuis `GET /me` au boot (backend wins) ; changement via `EditorLangSwitcher` → PATCH fire-and-forget. Anonymous → localStorage only.
- **`users.is_admin`** (BOOLEAN, default `false` — migration 0006) : flag super-admin plateforme. Amorçage env `ADMIN_BOOTSTRAP_EMAILS` (CSV) dans `userAuth` : un user dont l'email est listé est promu à sa prochaine requête authentifiée (write DB une seule fois, guard `!isAdmin` ; couvre login/signup/Discord). Exposé dans `GET /me`. Garde middleware `requireAdmin()` (403 si non-admin ; à câbler aux routes admin en plan 2).

## Super-admin & config plateforme

- **`app_settings`** (migration 0006) : store générique key/value plateforme-wide. `(key PK, value TEXT — JSON stringifié, updated_at, updated_by → users.id)`. Usage prévu : config de l'assistant IA gérée par le super-admin. Les secrets dans `value` sont chiffrés via `secretBox` (AES-256-GCM, clé `CONFIG_ENC_KEY`) avant stockage ; `isSecretsConfigured()` gate le fallback env quand la clé n'est pas configurée. Pas d'endpoint/UI au plan 1 (socle) — branchés aux plans 2 (config IA backend) & 3 (UI `/admin`).

## Assistant IA — conversations

- **`assistant_conversations`** (migration 0007) : historique du chat assistant, scopé par `(owner_key, project_id)` (index `assistant_conv_owner_project_idx`). `(id PK, owner_key TEXT, project_id TEXT, title TEXT, messages JSONB — transcript LLM complet pour la reprise, created_at, updated_at)`. `owner_key` = `sk:<serverKeyId>` (session plugin) ou `user:<userId>` (login web), miroir de `resolveOwnerKey` (`modules/assistant/routes.ts`). La working-copy n'est **pas** persistée (reconstruite depuis le project vivant à chaque tour). `title` dérivé du 1er message utilisateur. Pas de FK sur `project_id`/`owner_key` — des conversations orphelines sont tolérées si le project est supprimé.

## AI models & credits (2026-07-02)

- **`ai_models`** — catalogue admin des modèles IA (prix credits + coût réel micro-USD par 1M tokens, badge cheap/balanced/premium, `is_default` unique via index partiel). Jamais supprimés, seulement désactivés.
- **`ai_usage_log`** — une row par tour d'assistant : acteur (`user_id` ou `server_key_id`), `network_id` (porteur du débit), snapshots modèle, tokens, `credits_charged` (0 si `status='error'`), `real_cost_micro_usd`, `prompt_preview` (~200 chars — contenu complet dans `assistant_conversations`).
- **`ai_credit_ledger`** — solde d'un network = `SUM(delta)`. `reason ∈ {grant, debit, refund, adjustment}` ; les débits pointent `usage_log_id`. Le **network** porte les credits (décision spec 2026-07-02) : sessions user ET server-key débitent le network du project.
- **Buckets de credits (2026-07-03)** — `ai_credit_ledger` porte `bucket` (`subscription`/`rollover`/`topup`), `expires_at` (bucket subscription expire en fin de période), `period_id`. Solde d'un bucket = `SUM(delta)` non expiré. Débit dans l'ordre subscription → rollover → topup. `renewSubscriptionPeriod` (backend) auto-roule le solde restant (period-scoped, via `period_id`) du bucket subscription vers rollover, plafonné à `rollover_cap`. Les débits d'un bucket subscription héritent de l'`expires_at`/`period_id` du grant qu'ils consomment (`debitBuckets`), pour que grant et débits sortent ensemble de la SUM non-expirée. Spec `2026-07-03-billing-subscriptions-topups-design.md`.
- `users.preferred_ai_model_id` — dernier modèle choisi (pas de FK, fallback silencieux sur le défaut si dangling).

## Transferts & désaffectation

- **`network_transfers`** : `(token, network_id, initiated_by_user_id, expires_at, consumed_at, consumed_by_user_id, created_at)`. Token partageable 24h pour transférer la propriété d'un Network entier. Memberships swap **clean break** — ancien owner perd l'accès.
- **Server key deletion** : DELETE server_key (owner-only) → cascade les projects liés (`projects.serverKeyId` FK cascade). Le plugin perd la connexion au prochain hello.
- **Désaffectation sans transfert** : delete la server_key, re-setup côté plugin → l'auto-push (`local_push` au hello) recharge les projects dans le nouveau network. Pas de mutation cross-account.
- **Bootstrap auto-push** : au hello, les projects disque inconnus du backend (`disk_hash != "" && backend_hash == ""`) sont auto-pushés via `local_push` (plus de `/artisan pushLocal` manuel pour le first-time setup).

## Custom items cache

Cache disque : `backend/data/custom-items/{server_key_id}/{hash.txt, items.json, textures/}`. Peuplé par le plugin via WS `custom_items_bundle`.

**Invariant hash** : `CustomItemsManager.buildBundle()` calcule le hash inline depuis les items/textures déjà collectés (ne rappelle pas `computeHash()` séparément) — cohérence hash ↔ data.

## Présence des modules (`server_modules`)

`server_modules(server_key_id, module_id, version, last_seen)` — ensemble des modules actifs par serveur, **remplacé à chaque `hello`** depuis `installed_modules` (upsert + prune dans `persistServerModules`, `hub.ts`). PK composite `(server_key_id, module_id)`, FK → `server_keys` cascade. **Présence uniquement** : pilote la visibilité des modules dans l'éditeur ; cacher un module (retirer la ligne) **ne supprime jamais** le contenu authored (qui vit dans `projects`/etc.). Cf. `docs/superpowers/specs/2026-06-15-modules-architecture-design.md` §8.

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
