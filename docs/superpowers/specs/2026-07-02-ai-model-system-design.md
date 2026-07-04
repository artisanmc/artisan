# Système de modèles IA — catalogue admin, sélecteur user, métering & credits

**Statut :** design approuvé (brainstorm 2026-07-02).
**Auteur :** brainstorm 2026-07-02
**Filiation :** réalise et remplace le **sub-plan 3 (crédits)** du spec `2026-06-08-ai-assistant-design.md`, en l'étendant : catalogue de modèles multi-provider, sélecteur user, analytics admin. Le porteur de credits, laissé ouvert dans l'ancien spec (`accountId`), est tranché : **network**.
**Code lié (à créer) :** `backend/src/modules/ai/` (models, providers, credits, metering), pages admin `/admin/ai*`, sélecteur de modèle + solde dans le panneau assistant.
**Code lié (modifié) :** `backend/src/modules/assistant/` (loop.ts, routes.ts — consommateur du module `ai`), `OpenAICompatibleProvider` (réutilisé tel quel), `lib/appSettings.ts` + `lib/secretBox.ts` (réutilisés), `middleware/requireAdmin.ts` (réutilisé), `AdminSidebar`, suppression de `adminRoutes.ts` assistant-config + `AssistantConfigForm`.

## Contexte

L'assistant IA est shippé avec **un seul modèle global** (`app_settings.assistant.model`), une seule clé provider, aucune persistance d'usage (les événements `usage` sont émis en SSE puis ignorés) et aucun credits. Le cahier des charges 2026-07-02 demande :

1. **Panel admin** — gérer un catalogue de modèles (multi-provider, prix, badges, défaut, test rapide).
2. **Sélecteur user** — choisir son modèle en connaissance de cause (badge, description, estimation de coût), mémorisé, changeable en cours de conversation.
3. **Consommations admin** — dashboards (tokens, credits facturés, coût réel, marge, répartitions, évolution), logs filtrables + export, focus par user.
4. **Règles** — blocage à solde nul, pas de débit sur erreur provider, fallback si défaut désactivé, panel protégé, prompts tronqués par défaut.

## Décisions du brainstorm

| Question | Choix |
|---|---|
| Périmètre credits | **Ledger + débit + blocage inclus** ; l'achat réel (Stripe) reste un projet séparé — le « redirigé vers l'achat » pointe vers une page placeholder |
| Porteur du solde | **Network** (dérivé du project de la conversation). Les sessions server-key (`sk:`) débitent le network de leur server key ; les stats par user viennent des logs |
| Multi-provider | **OpenAI-compat partout** — l'unique `OpenAICompatibleProvider` + une entrée credentials (baseUrl, clé chiffrée) par provider. Anthropic/Google/DeepSeek exposent tous un endpoint compatible |
| Rôles | **`is_admin` pour tout en V1** — panel, analytics, vue complète des prompts (tronqués par défaut dans l'UI) |
| Marge | **Saisie admin** : prix réels USD/1M tokens par modèle + setting global « valeur d'un credit en USD » |
| Amorçage des soldes | **Grant admin uniquement** — pas de grant automatique à la création de network |
| Architecture | **Nouveau module `ai`** (`backend/src/modules/ai/`) ; le module `assistant` en devient un consommateur |

## Goals

- L'admin gère un **catalogue de modèles** multi-provider : prix credits, prix réels USD, badge, description, actif/inactif, défaut unique, test live.
- Le user **choisit son modèle** parmi les actifs, voit badge + description + estimation de coût par action typique, son choix est mémorisé, il peut changer en cours de conversation sans perdre le contexte.
- Chaque tour d'assistant est **métré** (tokens, credits, coût réel, statut) et **débité** du solde network ; solde nul = refus propre.
- L'admin pilote **coût et marge** : dashboards par période, répartitions modèle/provider, évolution, logs filtrables exportables, focus user.

## Non-goals (V1)

- **Achat réel de credits** (Stripe, abonnements) — ~~page placeholder seulement~~ **RÉALISÉ** par le sous-projet billing C : la route `/credits` est désormais une vraie page (achat de packs + abonnement via Stripe Checkout, gestion via Customer Portal, historique). Voir `docs/superpowers/plans/2026-07-04-billing-C-credit-ui.md`.
- Rate limiting par user, discounts/promo codes, sélection automatique du modèle selon la tâche, A/B testing (hors périmètre cahier des charges).
- **Suppression de modèle** — désactivation uniquement (l'historique y réfère).
- Grant automatique à la création de network.
- Tables d'agrégation pré-calculées — les dashboards sont des `GROUP BY` SQL sur `ai_usage_log`.
- SDKs providers natifs (prompt caching Anthropic natif, etc.) — extension ultérieure derrière la même interface `LlmProvider`.
- Actions IA non-chat (migration batch, génération hors conversation) — le champ `action_type` les anticipe, seul `chat` existe en V1.

## Modèle de données

3 nouvelles tables + 1 colonne + 2 rows `app_settings`. Migration Drizzle générée (`bun run db:generate`) et committée.

### `ai_models` — catalogue

| Colonne | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `display_name` | text | Nom visible user |
| `description` | text | Courte, visible user |
| `badge` | text | `cheap \| balanced \| premium` |
| `provider` | text | Slug : `anthropic`, `openai`, `deepseek`, `google`, ou custom — clé dans `ai_providers` |
| `provider_model_id` | text | Ex. `claude-sonnet-5` |
| `credits_per_m_input` | integer | Credits par 1M tokens input |
| `credits_per_m_output` | integer | Credits par 1M tokens output |
| `real_usd_per_m_input` | integer | **Micro-USD** par 1M tokens ($0.075 → 75 000) — pas de flottants en DB |
| `real_usd_per_m_output` | integer | idem |
| `is_active` | boolean | default true |
| `is_default` | boolean | default false — **index unique partiel** (une seule row à true) |
| `created_at` / `updated_at` | timestamp | |

### `ai_usage_log` — une row par tour (ou action IA future)

| Colonne | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `network_id` | FK networks | Porteur du débit |
| `user_id` | FK users, nullable | Acteur si session user |
| `server_key_id` | FK server_keys, nullable | Acteur si session `sk:` |
| `model_id` | FK ai_models, nullable | |
| `model_name` / `provider` / `provider_model_id` | text | **Snapshots** — le log survit aux renommages |
| `action_type` | text | `chat` (V1) — extensible `migration \| generation \| other` |
| `conversation_id` | FK assistant_conversations, nullable | Lien vers le transcript complet |
| `input_tokens` / `output_tokens` / `cached_input_tokens` | integer | Somme des `usage` du tour |
| `credits_charged` | integer | 0 si erreur |
| `real_cost_micro_usd` | integer | Calculé aux prix du modèle au moment du tour |
| `duration_ms` | integer, nullable | |
| `status` | text | `success \| error` |
| `error_message` | text, nullable | |
| `prompt_preview` | text | ~200 premiers chars du message user — **seul contenu stocké dans le log** |
| `created_at` | timestamp | |

Index : `(network_id, created_at)`, `(user_id, created_at)`, `(model_id)`, `created_at`.

**Vie privée** : le contenu complet vit déjà dans `assistant_conversations.messages` — la « vue complète » admin = lien vers le transcript (gate `is_admin`). Aucune duplication.

### `ai_credit_ledger` — solde = `SUM(delta)` par network

| Colonne | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `network_id` | FK networks | |
| `delta` | integer | Grant positif / débit négatif |
| `reason` | text | `grant \| debit \| refund \| adjustment` |
| `usage_log_id` | FK ai_usage_log, nullable | Renseigné pour les débits |
| `note` | text, nullable | |
| `created_by` | FK users, nullable | Admin pour les grants |
| `created_at` | timestamp | |

Index `(network_id, created_at)`. Pas de solde matérialisé en V1 — `SUM` indexé suffit.

### Divers

- **`users.preferred_ai_model_id`** — FK ai_models, nullable. Dernier choix, cross-device. Sessions `sk:` : localStorage.
- **`app_settings.ai_providers`** : `{ [slug]: { label, baseUrl, apiKeyEncrypted } }` — clés chiffrées via `secretBox` (`CONFIG_ENC_KEY`), write-only côté API (pattern `keySet` existant).
- **`app_settings.ai_settings`** : `{ creditUsdMicroRate, maxCreditsPerTurn? }` — taux credit→USD pour la marge + plafond optionnel par tour (garde-fou boucle agentique).

**Formule de débit** : `ceil((input_tokens × credits_per_m_input + output_tokens × credits_per_m_output) / 1_000_000)`. Les tokens cachés comptent comme input en V1 (pas de pricing cache séparé).

## Backend — module `ai`

`backend/src/modules/ai/` (BackendModule, monté dans `app.ts`) :

- **`models/`** — repo CRUD + `resolveModel(modelId?)` : modelId demandé (actif) → sinon défaut → **si défaut inactif ou absent, fallback déterministe** : premier actif trié badge (`cheap` → `balanced` → `premium`) puis nom.
- **`providers/`** — lecture/écriture `ai_providers` + `createProviderFor(model)` : instancie `OpenAICompatibleProvider` avec le baseUrl + clé du provider du modèle. **L'interface `LlmProvider` ne change pas.**
- **`credits/`** — `getBalance(networkId)`, `grant({networkId, amount, note, createdBy})`, `debitForUsage(usageLog)` (insert usage_log + ledger dans **une transaction**).
- **`metering/`** — agrégats summary (totaux, répartitions, série journalière), logs paginés (cursor), export CSV, focus user.

### Cycle d'un tour d'assistant

Modifications dans `assistant/routes.ts` + `loop.ts` :

1. `POST /conversations/:id/messages` accepte **`modelId` optionnel** → `resolveModel`.
2. **Pre-check** : network résolu via le project de la conversation → `getBalance` ; si ≤ 0 → erreur structurée `insufficient_credits`, aucun tour, aucun débit.
3. Le tour tourne ; la loop **accumule les événements `usage`** (déjà émis, aujourd'hui ignorés). Si `maxCreditsPerTurn` est dépassé en cours de tour, la loop s'arrête proprement à la fin de l'itération courante.
4. **Fin de tour** : transaction `ai_usage_log` (`status=success`) + débit ledger. **Erreur provider** → usage_log `status=error` avec les tokens réellement consommés (visibilité admin), **aucun débit**.
5. Nouvel événement SSE **`credits { debited, balance }`** en fin de stream.

### API REST

Tout sous `/api/v1`, admin = `userAuth()` + `requireAdmin()` (pattern existant).

| Route | Rôle |
|---|---|
| `GET/POST /admin/ai/models`, `GET/PUT /admin/ai/models/:id` | CRUD catalogue (pas de DELETE) |
| `PUT /admin/ai/models/:id/default` | Définir le défaut (transactionnel : unset l'ancien) |
| `POST /admin/ai/models/:id/test` | Test live « Reply with OK. » → latence + tokens + coût estimé |
| `GET/PUT /admin/ai/providers` | Credentials par provider — clé write-only, `keySet` boolean |
| `GET/PUT /admin/ai/settings` | Taux credit→USD, plafond par tour |
| `GET /admin/ai/usage/summary?from&to` | Totaux tokens/credits/coût réel/**marge** + répartitions modèle & provider + série journalière |
| `GET /admin/ai/usage/logs?user&model&provider&action&status&from&to&cursor` | Logs paginés ; `&format=csv` = export mêmes filtres |
| `GET /admin/ai/users/:userId?from&to` | Focus user : conso, répartition par modèle, tokens cumulés, networks avec soldes + historique grants |
| `POST /admin/ai/credits/grant` | `{networkId, amount, note}` |
| `GET /ai/models` (authentifié, non-admin) | Modèles **actifs** : nom, description, badge, prix credits, estimations par action typique |
| `GET /ai/balance?projectId` | Solde du network courant (session user ou `sk:`) |

Marge = `credits facturés × creditUsdMicroRate − Σ real_cost_micro_usd`.

## UI éditeur

Design system d'abord (`components/ui` + tokens, spécimen `/admin/design` pour tout nouveau composant, même commit). Tous les strings via react-i18next (en + fr). Mobile : pas d'affordance hover-only.

### Panel admin

- **`/admin/ai` — Modèles** (remplace la page config assistant) : table du catalogue (nom, provider, badge, prix credits, coût réel, actif, défaut) triable/filtrable, toggle actif, « définir par défaut », édition en Sheet, bouton **Test** par ligne (latence + tokens + coût du ping). Section **Providers** sur la même page : une carte par provider (baseUrl, clé write-only `keySet`) + ajout de provider custom.
- **`/admin/ai/usage` — Consommations** : période (7j / 30j / custom), cartes stats (tokens in/out, credits facturés, coût réel USD, marge), répartitions modèle & provider (barres horizontales), évolution journalière. **Pas de lib de charts** — barres SVG/CSS maison ajoutées au design system.
- **`/admin/ai/usage/logs`** : table paginée, filtres (user, modèle, provider, action, statut, période), **Export CSV**, détail par ligne : `prompt_preview` tronqué + lien « ouvrir la conversation » (vue complète, admin).
- **`/admin/users/:userId`** — onglet **AI** : conso totale sur période, répartition par modèle, tokens cumulés, networks du user avec **solde + historique grants + bouton « Créditer »** (le grant vit ici — pas de page networks admin).
- `AdminSidebar` : entrée AI éclatée en **Modèles** et **Consommations**.

### Panneau assistant (user)

- **Sélecteur de modèle** dans le composer : dropdown des modèles actifs — nom, badge, description, estimation « ~N credits / message · ~M credits / migration de menu ». Profils de tokens typiques = **constantes code** en V1 (ex. chat ≈ 2k in / 500 out ; migration ≈ 10k in / 3k out) × prix du modèle. Présélection : `preferred_ai_model_id` → sinon défaut. Le `modelId` part avec **chaque message** → changement en cours de conversation sans conversion (transcript provider-agnostique).
- **Chip solde** du network en tête de panneau, mis à jour par l'événement SSE `credits`.
- **État « plus de credits »** : composer désactivé + explication + CTA vers la page `/credits` (achat réel, sous-projet billing C).

## Cas limites & règles

- **Solde insuffisant** → refus avant le tour, erreur `insufficient_credits`, zéro débit, UI dédiée.
- **Erreur provider en cours de tour** → log `status=error`, tokens consommés loggés, **aucun débit** (perte assumée plateforme).
- **Défaut désactivé** → fallback runtime déterministe (cf. `resolveModel`) ; l'UI admin demande de choisir un nouveau défaut au moment de la désactivation.
- **Activation d'un modèle dont le provider n'a pas de clé** → refusée (guard `keySet`).
- **Tours concurrents** même network : les deux pre-checks peuvent passer → solde légèrement négatif possible. Accepté en V1, ledger exact.
- **Modèle préféré désactivé** → le sélecteur retombe silencieusement sur le défaut.
- **Prompts tronqués par défaut** : les logs n'exposent que `prompt_preview` ; vue complète = transcript de conversation, `is_admin`.

## Migration de l'existant

- **Seed legacy** : au boot, si le catalogue est vide et `app_settings.assistant` (ou env `ASSISTANT_*`) existe → créer l'entrée `ai_providers` + un `ai_model` défaut correspondant, une fois, en DB. Le **fallback env runtime est supprimé** — un seul chemin de résolution.
- Suppression : routes `assistant-config` (`adminRoutes.ts` assistant), `AssistantConfigForm`, `dbConfig.ts` (remplacé par `providers/`).
- Env vars : `ASSISTANT_PROVIDER/BASE_URL/API_KEY/MODEL` ne servent plus qu'au seed initial — documenté dans `.env.example`.

## Tests (TDD)

- **Backend** : CRUD modèles + unicité du défaut (index partiel + route transactionnelle), `resolveModel` (demandé/défaut/fallback), grant/debit/balance, **tour complet avec provider scripté** (`__setProviderForTests`) vérifiant usage_log + ledger + SSE `credits`, erreur provider → pas de débit, refus à zéro, `maxCreditsPerTurn`, agrégats summary (fixtures multi-modèles/providers), export CSV, focus user, guards `requireAdmin`, clé write-only providers, seed legacy.
- **Éditeur** : sélecteur (liste, présélection, estimations, modèle préféré désactivé), chip solde + état à sec, table modèles + form + test, dashboard avec fixtures, filtres logs + export, onglet AI user, clés i18n en+fr présentes.
- **Migration Drizzle** committée.

## Docs impactées

| Doc | Quoi |
|---|---|
| `docs/architecture/rest-endpoints.md` | Nouvelles routes `/admin/ai/*`, `/ai/*` ; retrait `assistant-config` |
| `docs/architecture/entities.md` | `ai_models`, `ai_usage_log`, `ai_credit_ledger`, porteur network |
| `CHANGELOG.md [Unreleased]` | Endpoints ajoutés/retirés |
| `docs/architecture/editor-internals.md` | Composant barres (design system) |
| `docs-site/.../editor/` | Page sélecteur de modèle + credits (user-facing) |
| `.env.example` | `ASSISTANT_*` = seed uniquement |
| `docs/superpowers/specs/2026-06-08-ai-assistant-design.md` | Note : sub-plan 3 réalisé par ce spec |
