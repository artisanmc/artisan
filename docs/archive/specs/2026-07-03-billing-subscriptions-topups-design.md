# Billing — Subscriptions, credit top-ups and balance indicator (Stripe)

**Status:** design approved (brainstorm 2026-07-03).
**Lineage:** delivers the "real credit purchase" piece explicitly deferred by the AI model system (`2026-07-02-ai-model-system-design.md`) — the `/credits` route is a placeholder today. Builds on the per-network credit ledger (`ai_credit_ledger`) and the assistant metering already shipped.
**Author:** brainstorm 2026-07-03.

## Context

The AI model system bills each assistant turn in credits debited from the **network** (`ai_credit_ledger`, flat SUM(delta), 402 refusal at zero). Nobody can *acquire* credits: the only supply is a manual admin grant. This spec adds acquisition (one-off top-ups + recurring subscriptions via Stripe), the typed-credits model (subscription / rollover / top-up) with debit order, and a permanent balance indicator on the user side.

## Brainstorm decisions

| Question | Choice |
|---|---|
| Credits & subscription carrier | **Network** (shared team pot; the owner pays/manages). Consistent with the per-network AI ledger + `networks.tier`/`subscription_id` already in the DB. "The user" in the requirements = the owner member acting for their network. |
| Stripe integration | **Hosted Checkout + Customer Portal.** Stripe handles PCI, invoices, retries, dunning, subscription management (plan change, payment method, cancellation). Artisan mostly codes the webhooks + the products/prices provisioning. |
| V1 scope | **Payment core + buckets + indicator** (detail §Non-goals). |
| Emails | **Stripe native** in V1 (receipts, invoices, failures, reminders configured in the dashboard). Custom Artisan emails = V1.5. |
| Bucket model | **Append-only extension of `ai_credit_ledger`** (`bucket`, `expires_at`, `period_id`) — no mutable balances. |

## Goals

- A network can **buy credit packs** (one-off top-up, repeatable) and **subscribe to a monthly plan** via Stripe.
- Credits live in **3 typed buckets** — `subscription` (month's quota, expires), `rollover` (capped carry-over), `topup` (permanent) — debited in that order (§4.1).
- A **permanent balance indicator** shows the total, the breakdown, the low/zero states, and a top-up CTA, wherever credits are consumed (today: the assistant panel).
- The admin **manages packs and plans** (provisioned in Stripe) and **tracks sales** (revenue, active subscribers).
- The whole payment/billing/subscription management chain goes through the **Stripe hosted pages** (Checkout, Customer Portal).

## Non-goals (V1)

- **Annual subscription** (V1 = monthly only; the schema carries `interval` to extend it).
- **Custom Artisan emails** (branding, app-specific low-balance alert) — Stripe natively covers receipts/invoices/failures/reminders.
- **Advanced analytics** churn / ARPU / MRR (V1 = revenue per period + active subscriber counters per plan).
- **Detailed "balance after operation" preview** before an expensive action — V1 = the model selector's estimates (already in place) + 402 blocking.
- **Proactive in-app notifications** (banners, reminders) — V1 = the indicator's color states + the `/credits` page.
- **Custom in-app Stripe Elements** — all payment/management goes through the hosted pages.

## Architecture — split into 4 sub-projects

Too vast for a single plan. Each sub-project = its plan → execution.

- **A — Credit bucket engine** (pure backend, foundation). Ledger extension, debit order §4.1, expiration/rollover, rework of `recordDebitedTurn` / `getBalance`. Testable in isolation, no Stripe.
- **B — Stripe integration** (backend). Admin CRUD of packs + plans (provisions Stripe products/prices), creation of Checkout sessions (top-up + subscription), webhook handler (credits the buckets, handles subscription status/grace, idempotence), Customer Portal link.
- **C — User UI**. `CreditIndicator`, `/credits` page (pack purchase + subscription + subscription management + history).
- **D — Sales admin**. Pack/plan management, revenue + active subscribers tracking, manual grant (audit).

**Order:** A → B → (C ∥ D). Backend modules: sub-project A lives in `backend/src/modules/ai/` (the ledger is there); B/D add a billing domain `backend/src/modules/billing/` (or `routes/billing.ts` + `lib/stripe.ts` routes), to decide in plan B.

## Data model

Drizzle migrations generated + committed (`bun run db:generate`).

### `ai_credit_ledger` extension (append-only, sub-project A)

| Added column | Type | Notes |
|---|---|---|
| `bucket` | text | `subscription \| rollover \| topup`. Existing entries (admin grants) migrate to `topup`. |
| `expires_at` | timestamp nullable | End of validity (`subscription` bucket = end of period; `rollover`/`topup` = null). The balance excludes expired entries. |
| `period_id` | text nullable | Links an entry to a subscription period (renewal / rollover). |

A bucket's balance = `SUM(delta)` of that bucket's entries with `expires_at IS NULL OR expires_at > now()`. Total balance = sum of the 3.

### `credit_packs` (sub-project B)

`id`, `name`, `price_cents` (int), `currency` (`eur`), `credits` (int = base credits), `bonus_pct` (int, default 0), `is_active` (bool), `sort_order` (int), `stripe_price_id` (text), timestamps. **Credits granted = `credits + round(credits * bonus_pct / 100)`** (the §1.1 bonus is an additive supplement, not included in `credits`). The computation lives in the webhook handler, tested.

### `subscription_plans` (sub-project B)

`id`, `name`, `interval` (`month` in V1; `year` reserved), `price_cents`, `currency`, `credits_per_period` (int), `rollover_cap` (int, 0 = no rollover), `features` (text/jsonb, description of benefits), `is_active`, `sort_order`, `stripe_price_id`, timestamps.

### `network_billing` (sub-project B)

`network_id` (PK, FK networks cascade), `stripe_customer_id`, `stripe_subscription_id` nullable, `plan_id` (FK subscription_plans) nullable, `status` (`active \| past_due \| grace \| canceled` — null/absent = no subscription), `current_period_end` timestamp nullable, `grace_until` timestamp nullable, timestamps. `networks.tier` stays a denormalized flag (`free`/plan slug) updated by the webhook.

### `credit_purchases` (top-ups audit, sub-project B)

`id`, `network_id` (FK), `pack_id` (FK, nullable if pack deleted), `stripe_session_id`, `stripe_invoice_url` nullable, `amount_cents`, `currency`, `credits` (granted), `created_by` (FK users, the purchasing member), `created_at`. Serves the §1.3 history (the invoices themselves live in Stripe, we store the URL).

### `stripe_events` (webhook idempotence, sub-project B)

`event_id` (PK, the Stripe event `id`), `type`, `processed_at`. A webhook already seen (same `event_id`) is ignored.

## Debit order & rollover (sub-project A)

**Debit (§4.1).** `recordDebitedTurn` (today: a single `debit` entry) becomes: compute the available balance per bucket (`subscription`, `rollover`, `topup`), then walk in that order drawing down until the total due is covered — insert **one negative entry per drawn bucket**, tagged `bucket`, the sum = credits due. The turn's pre-check reads the **total balance** (already in place, `getBalance` → sum of the 3 non-expired buckets). No debit on provider error (already in place). New accessor `getBucketBalances(networkId)` → `{ subscription, rollover, topup, total, subscriptionQuota, periodEnd }` for the indicator.

**Rollover / renewal (§2.2, triggered by the subscription `invoice.paid` webhook, sub-project B but logic in A).** In one append-only transaction:
1. The remainder of the closed period's `subscription` bucket moves to `rollover`, capped at the plan's `rollover_cap` (entries: a debit of the subscription remainder + a rollover credit of min(remainder, cap)).
2. The surplus beyond the cap is simply left to expire (the closed period's `expires_at` is reached).
3. A new `subscription` batch of `credits_per_period` is credited, `expires_at` = end of the new period, `period_id` = new period.

**Expiration.** No entry is deleted; a bucket's balance simply excludes entries with `expires_at <= now()`. An expired `subscription` bucket stops counting at the end of the period without a job (read-time).

## Stripe flows (sub-project B)

- **Top-up.** `POST /api/v1/billing/checkout/pack` `{ packId, projectId|networkId }` → creates a **Checkout Session** (mode `payment`, line = the pack's `stripe_price_id`) → returns the URL. Success return → `checkout.session.completed` (webhook) → writes `credit_purchases` + a ledger entry `bucket=topup`, `reason=grant`. Idempotent via `stripe_events`.
- **Subscription.** `POST /api/v1/billing/checkout/subscription` `{ planId, networkId }` → Checkout Session mode `subscription` → URL. `checkout.session.completed` + `invoice.paid` (first period) → creates/updates `network_billing` (`active`, `current_period_end`), credits the `subscription` batch, sets `networks.tier`.
- **Renewals.** Recurring `invoice.paid` → rollover + new `subscription` batch (logic §rollover above).
- **Payment failure (§2.5).** `invoice.payment_failed` → `status=past_due` then `grace` with `grace_until = now + grace_days` (admin config). Past the deadline (`customer.subscription.updated` status unpaid/canceled, or read-time check) → no more credit renewal; already available credits stay usable. Failure/reminder emails = Stripe native.
- **Change / cancellation.** `customer.subscription.updated`/`deleted` → update `plan_id`/`status`/`current_period_end`. On cancellation, access until `current_period_end`; rollover + top-up kept.
- **Management.** `POST /api/v1/billing/portal` → **Billing Portal Session** → URL (change plan, payment method, cancel, download invoices).
- **Webhook security:** signature verification (`STRIPE_WEBHOOK_SECRET`), dedicated public unauthenticated endpoint, `stripe_events` idempotence.

Env variables: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PUBLISHABLE_KEY` (front, if needed), `BILLING_SUCCESS_URL`/`BILLING_CANCEL_URL` (Checkout returns), `BILLING_GRACE_DAYS` (default 7). Documented in `.env.example` + CLAUDE.md.

## UI (sub-project C)

Design-system-first (`components/ui` + tokens), en+fr i18n, mobile-friendly.

- **`CreditIndicator`** — segmented bar (month's subscription quota consumed) + numeric total + context ("of X this month" if a subscription is active) + color states (yellow <20% of the quota, red <5%, zero) + popover: subscription remaining this month, renewal date, permanent top-up, recent 7d consumption, top-up/manage CTA. Consumes `GET /api/v1/ai/balance` extended into `GET /api/v1/billing/balance` → `getBucketBalances`. Replaces/augments the assistant composer's `BalanceChip`.
- **`/credits`** (replaces the placeholder) — grid of packs (buy button → Checkout), plan cards (subscribe → Checkout), "My subscription" section (active plan + renewal date + "Manage" → Customer Portal), purchase history + invoice links (`credit_purchases` + Stripe). Balance at zero → clear message + these same CTAs. The blocked composer (402, already in place) routes its CTA to this page.

## Admin (sub-project D)

> **DELIVERED 2026-07-04** (branch `feat/billing-D-admin`). `/admin/billing` page (Tabs Sales/Packs/Subscriptions/Grant), endpoints `GET /api/v1/admin/billing/sales` + `POST /api/v1/admin/billing/grant`. Top-up revenue **per currency** (no cross-currency sum), active subscribers/plan derived from the status. Churn/ARPU/MRR remain V1.5. Plan: `docs/superpowers/plans/2026-07-04-billing-D-admin.md`.

`/admin/billing`: CRUD of packs + plans (create/edit = provisions the Stripe product/price via API; deactivate rather than delete). Sales tracking: revenue per period (7d/30d/custom, top-ups vs subscriptions, from `credit_purchases` + subscription status), number of active subscribers per plan. Manual grant (bucket `topup`, `reason=adjustment`, `note` = reason — builds on the existing grant route, extended). Churn/ARPU/MRR analytics = V1.5.

## Tests

- **A**: multi-bucket debit order, read-time expiration, rollover cap, renewal transaction, `getBucketBalances`. Backend unit tests (`bun run test`).
- **B**: Stripe provisioning (mock SDK), Checkout/Portal creation, webhook handler with fixture events (`checkout.session.completed`, `invoice.paid` initial + recurring, `payment_failed`, `subscription.updated/deleted`) + `stripe_events` idempotence, admin guards, signature security.
- **C/D**: indicator components (color states, popover, breakdown), `/credits` page, admin billing (CRUD, tracking), en+fr i18n.

## Impacted docs

`docs/architecture/entities.md` (buckets + billing tables), `rest-endpoints.md` (`/billing/*`), `CHANGELOG.md`, `.env.example` + CLAUDE.md (Stripe env), `docs/architecture/ws-protocol.md` (not concerned), docs-site (user purchase/subscription page), `2026-07-02-ai-model-system-design.md` (note: `/credits` delivered).
