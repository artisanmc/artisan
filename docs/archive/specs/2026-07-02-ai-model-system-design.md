# AI model system — admin catalog, user selector, metering & credits

**Status:** design approved (brainstorm 2026-07-02).
**Author:** brainstorm 2026-07-02
**Lineage:** delivers and replaces **sub-plan 3 (credits)** of the `2026-06-08-ai-assistant-design.md` spec, extending it: multi-provider model catalog, user selector, admin analytics. The credits carrier, left open in the old spec (`accountId`), is settled: **network**.
**Related code (to create):** `backend/src/modules/ai/` (models, providers, credits, metering), admin pages `/admin/ai*`, model selector + balance in the assistant panel.
**Related code (modified):** `backend/src/modules/assistant/` (loop.ts, routes.ts — consumer of the `ai` module), `OpenAICompatibleProvider` (reused as is), `lib/appSettings.ts` + `lib/secretBox.ts` (reused), `middleware/requireAdmin.ts` (reused), `AdminSidebar`, removal of the assistant-config `adminRoutes.ts` + `AssistantConfigForm`.

## Context

The AI assistant ships with **a single global model** (`app_settings.assistant.model`), a single provider key, no usage persistence (the `usage` events are emitted via SSE then ignored) and no credits. The 2026-07-02 requirements ask for:

1. **Admin panel** — manage a model catalog (multi-provider, prices, badges, default, quick test).
2. **User selector** — choose one's model knowingly (badge, description, cost estimate), remembered, changeable mid-conversation.
3. **Admin consumption** — dashboards (tokens, billed credits, real cost, margin, breakdowns, trends), filterable logs + export, per-user focus.
4. **Rules** — block at zero balance, no debit on provider error, fallback if the default is disabled, protected panel, prompts truncated by default.

## Brainstorm decisions

| Question | Choice |
|---|---|
| Credits scope | **Ledger + debit + blocking included**; the real purchase (Stripe) stays a separate project — the "redirected to purchase" points to a placeholder page |
| Balance carrier | **Network** (derived from the conversation's project). Server-key (`sk:`) sessions debit the network of their server key; per-user stats come from the logs |
| Multi-provider | **OpenAI-compat everywhere** — the single `OpenAICompatibleProvider` + one credentials entry (baseUrl, encrypted key) per provider. Anthropic/Google/DeepSeek all expose a compatible endpoint |
| Roles | **`is_admin` for everything in V1** — panel, analytics, full prompt view (truncated by default in the UI) |
| Margin | **Admin input**: real USD/1M tokens prices per model + global "value of a credit in USD" setting |
| Balance bootstrap | **Admin grant only** — no automatic grant on network creation |
| Architecture | **New `ai` module** (`backend/src/modules/ai/`); the `assistant` module becomes a consumer |

## Goals

- The admin manages a multi-provider **model catalog**: credits price, real USD price, badge, description, active/inactive, unique default, live test.
- The user **chooses their model** among the active ones, sees badge + description + cost estimate per typical action, their choice is remembered, they can switch mid-conversation without losing context.
- Every assistant turn is **metered** (tokens, credits, real cost, status) and **debited** from the network balance; zero balance = clean refusal.
- The admin steers **cost and margin**: dashboards per period, model/provider breakdowns, trends, filterable exportable logs, user focus.

## Non-goals (V1)

- **Real credit purchase** (Stripe, subscriptions) — ~~placeholder page only~~ **DONE** by billing sub-project C: the `/credits` route is now a real page (pack purchase + subscription via Stripe Checkout, management via Customer Portal, history). See `docs/superpowers/plans/2026-07-04-billing-C-credit-ui.md`.
- Per-user rate limiting, discounts/promo codes, automatic model selection by task, A/B testing (out of the requirements' scope).
- **Model deletion** — deactivation only (history refers to it).
- Automatic grant on network creation.
- Pre-computed aggregation tables — dashboards are SQL `GROUP BY`s on `ai_usage_log`.
- Native provider SDKs (native Anthropic prompt caching, etc.) — later extension behind the same `LlmProvider` interface.
- Non-chat AI actions (batch migration, generation outside a conversation) — the `action_type` field anticipates them, only `chat` exists in V1.

## Data model

3 new tables + 1 column + 2 `app_settings` rows. Drizzle migration generated (`bun run db:generate`) and committed.

### `ai_models` — catalog

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `display_name` | text | User-visible name |
| `description` | text | Short, user-visible |
| `badge` | text | `cheap \| balanced \| premium` |
| `provider` | text | Slug: `anthropic`, `openai`, `deepseek`, `google`, or custom — key in `ai_providers` |
| `provider_model_id` | text | E.g. `claude-sonnet-5` |
| `credits_per_m_input` | integer | Credits per 1M input tokens |
| `credits_per_m_output` | integer | Credits per 1M output tokens |
| `real_usd_per_m_input` | integer | **Micro-USD** per 1M tokens ($0.075 → 75,000) — no floats in DB |
| `real_usd_per_m_output` | integer | same |
| `is_active` | boolean | default true |
| `is_default` | boolean | default false — **partial unique index** (a single row at true) |
| `created_at` / `updated_at` | timestamp | |

### `ai_usage_log` — one row per turn (or future AI action)

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `network_id` | FK networks | Debit carrier |
| `user_id` | FK users, nullable | Actor if user session |
| `server_key_id` | FK server_keys, nullable | Actor if `sk:` session |
| `model_id` | FK ai_models, nullable | |
| `model_name` / `provider` / `provider_model_id` | text | **Snapshots** — the log survives renames |
| `action_type` | text | `chat` (V1) — extensible `migration \| generation \| other` |
| `conversation_id` | FK assistant_conversations, nullable | Link to the full transcript |
| `input_tokens` / `output_tokens` / `cached_input_tokens` | integer | Sum of the turn's `usage` |
| `credits_charged` | integer | 0 on error |
| `real_cost_micro_usd` | integer | Computed at the model's prices at the time of the turn |
| `duration_ms` | integer, nullable | |
| `status` | text | `success \| error` |
| `error_message` | text, nullable | |
| `prompt_preview` | text | ~first 200 chars of the user message — **only content stored in the log** |
| `created_at` | timestamp | |

Indexes: `(network_id, created_at)`, `(user_id, created_at)`, `(model_id)`, `created_at`.

**Privacy**: the full content already lives in `assistant_conversations.messages` — the admin "full view" = link to the transcript (`is_admin` gate). No duplication.

### `ai_credit_ledger` — balance = `SUM(delta)` per network

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `network_id` | FK networks | |
| `delta` | integer | Positive grant / negative debit |
| `reason` | text | `grant \| debit \| refund \| adjustment` |
| `usage_log_id` | FK ai_usage_log, nullable | Filled for debits |
| `note` | text, nullable | |
| `created_by` | FK users, nullable | Admin for grants |
| `created_at` | timestamp | |

Index `(network_id, created_at)`. No materialized balance in V1 — an indexed `SUM` is enough.

### Misc

- **`users.preferred_ai_model_id`** — FK ai_models, nullable. Last choice, cross-device. `sk:` sessions: localStorage.
- **`app_settings.ai_providers`**: `{ [slug]: { label, baseUrl, apiKeyEncrypted } }` — keys encrypted via `secretBox` (`CONFIG_ENC_KEY`), write-only on the API side (existing `keySet` pattern).
- **`app_settings.ai_settings`**: `{ creditUsdMicroRate, maxCreditsPerTurn? }` — credit→USD rate for the margin + optional per-turn cap (agentic loop safeguard).

**Debit formula**: `ceil((input_tokens × credits_per_m_input + output_tokens × credits_per_m_output) / 1_000_000)`. Cached tokens count as input in V1 (no separate cache pricing).

## Backend — `ai` module

`backend/src/modules/ai/` (BackendModule, mounted in `app.ts`):

- **`models/`** — CRUD repo + `resolveModel(modelId?)`: requested modelId (active) → otherwise default → **if the default is inactive or absent, deterministic fallback**: first active sorted by badge (`cheap` → `balanced` → `premium`) then name.
- **`providers/`** — read/write `ai_providers` + `createProviderFor(model)`: instantiates `OpenAICompatibleProvider` with the baseUrl + key of the model's provider. **The `LlmProvider` interface does not change.**
- **`credits/`** — `getBalance(networkId)`, `grant({networkId, amount, note, createdBy})`, `debitForUsage(usageLog)` (insert usage_log + ledger in **one transaction**).
- **`metering/`** — summary aggregates (totals, breakdowns, daily series), paginated logs (cursor), CSV export, user focus.

### Lifecycle of an assistant turn

Changes in `assistant/routes.ts` + `loop.ts`:

1. `POST /conversations/:id/messages` accepts an optional **`modelId`** → `resolveModel`.
2. **Pre-check**: network resolved via the conversation's project → `getBalance`; if ≤ 0 → structured error `insufficient_credits`, no turn, no debit.
3. The turn runs; the loop **accumulates the `usage` events** (already emitted, ignored today). If `maxCreditsPerTurn` is exceeded mid-turn, the loop stops cleanly at the end of the current iteration.
4. **End of turn**: transaction `ai_usage_log` (`status=success`) + ledger debit. **Provider error** → usage_log `status=error` with the tokens actually consumed (admin visibility), **no debit**.
5. New SSE event **`credits { debited, balance }`** at the end of the stream.

### REST API

All under `/api/v1`, admin = `userAuth()` + `requireAdmin()` (existing pattern).

| Route | Role |
|---|---|
| `GET/POST /admin/ai/models`, `GET/PUT /admin/ai/models/:id` | Catalog CRUD (no DELETE) |
| `PUT /admin/ai/models/:id/default` | Set the default (transactional: unsets the previous one) |
| `POST /admin/ai/models/:id/test` | Live test "Reply with OK." → latency + tokens + estimated cost |
| `GET/PUT /admin/ai/providers` | Per-provider credentials — write-only key, `keySet` boolean |
| `GET/PUT /admin/ai/settings` | Credit→USD rate, per-turn cap |
| `GET /admin/ai/usage/summary?from&to` | Totals tokens/credits/real cost/**margin** + model & provider breakdowns + daily series |
| `GET /admin/ai/usage/logs?user&model&provider&action&status&from&to&cursor` | Paginated logs; `&format=csv` = export with the same filters |
| `GET /admin/ai/users/:userId?from&to` | User focus: consumption, breakdown by model, cumulative tokens, networks with balances + grant history |
| `POST /admin/ai/credits/grant` | `{networkId, amount, note}` |
| `GET /ai/models` (authenticated, non-admin) | **Active** models: name, description, badge, credits prices, estimates per typical action |
| `GET /ai/balance?projectId` | Balance of the current network (user or `sk:` session) |

Margin = `billed credits × creditUsdMicroRate − Σ real_cost_micro_usd`.

## Editor UI

Design system first (`components/ui` + tokens, `/admin/design` specimen for any new component, same commit). All strings via react-i18next (en + fr). Mobile: no hover-only affordance.

### Admin panel

- **`/admin/ai` — Models** (replaces the assistant config page): catalog table (name, provider, badge, credits price, real cost, active, default) sortable/filterable, active toggle, "set as default", editing in a Sheet, per-row **Test** button (latency + tokens + cost of the ping). **Providers** section on the same page: one card per provider (baseUrl, write-only key `keySet`) + custom provider addition.
- **`/admin/ai/usage` — Consumption**: period (7d / 30d / custom), stat cards (tokens in/out, billed credits, real USD cost, margin), model & provider breakdowns (horizontal bars), daily trend. **No charts lib** — home-made SVG/CSS bars added to the design system.
- **`/admin/ai/usage/logs`**: paginated table, filters (user, model, provider, action, status, period), **CSV export**, per-row detail: truncated `prompt_preview` + "open the conversation" link (full view, admin).
- **`/admin/users/:userId`** — **AI** tab: total consumption over the period, breakdown by model, cumulative tokens, the user's networks with **balance + grant history + "Credit" button** (the grant lives here — no admin networks page).
- `AdminSidebar`: AI entry split into **Models** and **Consumption**.

### Assistant panel (user)

- **Model selector** in the composer: dropdown of active models — name, badge, description, estimate "~N credits / message · ~M credits / menu migration". Typical token profiles = **code constants** in V1 (e.g. chat ≈ 2k in / 500 out; migration ≈ 10k in / 3k out) × the model's price. Preselection: `preferred_ai_model_id` → otherwise default. The `modelId` goes with **each message** → switching mid-conversation without conversion (provider-agnostic transcript).
- **Balance chip** of the network at the top of the panel, updated by the SSE `credits` event.
- **"Out of credits" state**: composer disabled + explanation + CTA to the `/credits` page (real purchase, billing sub-project C).

## Edge cases & rules

- **Insufficient balance** → refusal before the turn, `insufficient_credits` error, zero debit, dedicated UI.
- **Provider error mid-turn** → log `status=error`, consumed tokens logged, **no debit** (loss borne by the platform).
- **Default disabled** → deterministic runtime fallback (cf. `resolveModel`); the admin UI asks to choose a new default at the time of deactivation.
- **Activating a model whose provider has no key** → refused (`keySet` guard).
- **Concurrent turns** on the same network: both pre-checks can pass → slightly negative balance possible. Accepted in V1, exact ledger.
- **Preferred model disabled** → the selector silently falls back to the default.
- **Prompts truncated by default**: the logs only expose `prompt_preview`; full view = conversation transcript, `is_admin`.

## Migration of the existing

- **Legacy seed**: at boot, if the catalog is empty and `app_settings.assistant` (or env `ASSISTANT_*`) exists → create the `ai_providers` entry + a matching default `ai_model`, once, in DB. The **runtime env fallback is removed** — a single resolution path.
- Removal: `assistant-config` routes (assistant `adminRoutes.ts`), `AssistantConfigForm`, `dbConfig.ts` (replaced by `providers/`).
- Env vars: `ASSISTANT_PROVIDER/BASE_URL/API_KEY/MODEL` only serve for the initial seed — documented in `.env.example`.

## Tests (TDD)

- **Backend**: models CRUD + default uniqueness (partial index + transactional route), `resolveModel` (requested/default/fallback), grant/debit/balance, **full turn with scripted provider** (`__setProviderForTests`) checking usage_log + ledger + SSE `credits`, provider error → no debit, refusal at zero, `maxCreditsPerTurn`, summary aggregates (multi-model/provider fixtures), CSV export, user focus, `requireAdmin` guards, write-only providers key, legacy seed.
- **Editor**: selector (list, preselection, estimates, disabled preferred model), balance chip + dry state, models table + form + test, dashboard with fixtures, logs filters + export, user AI tab, en+fr i18n keys present.
- **Drizzle migration** committed.

## Impacted docs

| Doc | What |
|---|---|
| `docs/architecture/rest-endpoints.md` | New `/admin/ai/*`, `/ai/*` routes; removal of `assistant-config` |
| `docs/architecture/entities.md` | `ai_models`, `ai_usage_log`, `ai_credit_ledger`, network carrier |
| `CHANGELOG.md [Unreleased]` | Endpoints added/removed |
| `docs/architecture/editor-internals.md` | Bars component (design system) |
| `docs-site/.../editor/` | Model selector + credits page (user-facing) |
| `.env.example` | `ASSISTANT_*` = seed only |
| `docs/superpowers/specs/2026-06-08-ai-assistant-design.md` | Note: sub-plan 3 delivered by this spec |
