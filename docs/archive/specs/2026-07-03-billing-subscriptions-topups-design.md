# Facturation — Abonnements, top-ups de credits et indicateur de solde (Stripe)

**Statut :** design approuvé (brainstorm 2026-07-03).
**Filiation :** réalise la pièce « achat réel de credits » explicitement différée du système de modèles IA (`2026-07-02-ai-model-system-design.md`) — la route `/credits` est aujourd'hui un placeholder. S'appuie sur le ledger de credits per-network (`ai_credit_ledger`) et le métering d'assistant déjà shippés.
**Auteur :** brainstorm 2026-07-03.

## Contexte

Le système de modèles IA facture chaque tour d'assistant en credits débités du **network** (`ai_credit_ledger`, SUM(delta) plat, refus 402 à zéro). Personne ne peut *acquérir* de credits : le seul apport est un grant admin manuel. Ce spec ajoute l'acquisition (top-ups ponctuels + abonnements récurrents via Stripe), le modèle de credits typés (abonnement / rollover / top-up) avec ordre de débit, et un indicateur de solde permanent côté user.

## Décisions du brainstorm

| Question | Choix |
|---|---|
| Porteur des credits & abonnement | **Network** (pot partagé de l'équipe ; l'owner paie/gère). Cohérent avec le ledger IA per-network + `networks.tier`/`subscription_id` déjà en base. « L'utilisateur » du cahier = le membre owner agissant pour son network. |
| Intégration Stripe | **Checkout + Customer Portal hébergés.** Stripe gère PCI, factures, retries, dunning, gestion d'abo (changement de formule, moyen de paiement, annulation). Artisan code surtout les webhooks + le provisioning products/prices. |
| Périmètre V1 | **Core paiement + buckets + indicateur** (détail §Non-goals). |
| Emails | **Natifs Stripe** en V1 (reçus, factures, échecs, rappels configurés dans le dashboard). Emails custom Artisan = V1.5. |
| Modèle de buckets | **Extension append-only de `ai_credit_ledger`** (`bucket`, `expires_at`, `period_id`) — pas de balances mutables. |

## Goals

- Un network peut **acheter des packs de credits** (top-up ponctuel, répétable) et **souscrire un abonnement mensuel** via Stripe.
- Les credits vivent en **3 buckets typés** — `subscription` (quota du mois, expire), `rollover` (report plafonné), `topup` (permanent) — débités dans cet ordre (§4.1).
- Un **indicateur de solde permanent** montre le total, la répartition, les états bas/zéro, et un CTA de rechargement, partout où des credits se consomment (aujourd'hui : le panneau assistant).
- L'admin **gère les packs et formules** (provisionnés dans Stripe) et **suit les ventes** (CA, abonnés actifs).
- Toute la chaîne de paiement/facturation/gestion d'abo passe par les **pages hébergées Stripe** (Checkout, Customer Portal).

## Non-goals (V1)

- **Abonnement annuel** (V1 = mensuel seulement ; le schéma porte `interval` pour l'étendre).
- **Emails custom Artisan** (branding, alerte solde bas app-spécifique) — Stripe couvre reçus/factures/échecs/rappels nativement.
- **Analytics avancées** churn / ARPU / MRR (V1 = CA par période + compteurs d'abonnés actifs par formule).
- **Preview détaillé « solde après opération »** avant action coûteuse — V1 = estimations du sélecteur de modèle (déjà en place) + blocage 402.
- **Notifications proactives in-app** (bannières, rappels) — V1 = états couleur de l'indicateur + page `/credits`.
- **Élements Stripe custom in-app** — tout le paiement/gestion passe par les pages hébergées.

## Architecture — découpage en 4 sous-projets

Trop vaste pour un plan unique. Chaque sous-projet = son plan → exécution.

- **A — Moteur de buckets de credits** (backend pur, fondation). Extension du ledger, ordre de débit §4.1, expiration/rollover, refonte de `recordDebitedTurn` / `getBalance`. Testable isolément, aucun Stripe.
- **B — Intégration Stripe** (backend). CRUD admin packs + formules (provisionne products/prices Stripe), création de sessions Checkout (top-up + abo), handler webhooks (crédite les buckets, gère statut abo/grace, idempotence), lien Customer Portal.
- **C — UI user**. `CreditIndicator`, page `/credits` (achat packs + souscription + gestion abo + historique).
- **D — Admin ventes**. Gestion packs/formules, suivi CA + abonnés actifs, grant manuel (audit).

**Ordre :** A → B → (C ∥ D). Modules backend : le sous-projet A vit dans `backend/src/modules/ai/` (le ledger y est) ; B/D ajoutent un domaine facturation `backend/src/modules/billing/` (ou routes `routes/billing.ts` + `lib/stripe.ts`), à trancher en plan B.

## Modèle de données

Migrations Drizzle générées + committées (`bun run db:generate`).

### Extension `ai_credit_ledger` (append-only, sous-projet A)

| Colonne ajoutée | Type | Notes |
|---|---|---|
| `bucket` | text | `subscription \| rollover \| topup`. Les entrées existantes (grants admin) migrent en `topup`. |
| `expires_at` | timestamp nullable | Fin de validité (bucket `subscription` = fin de période ; `rollover`/`topup` = null). Le solde exclut les entrées expirées. |
| `period_id` | text nullable | Lie une entrée à une période d'abonnement (renouvellement / rollover). |

Solde d'un bucket = `SUM(delta)` des entrées de ce bucket avec `expires_at IS NULL OR expires_at > now()`. Solde total = somme des 3.

### `credit_packs` (sous-projet B)

`id`, `name`, `price_cents` (int), `currency` (`eur`), `credits` (int = credits de base), `bonus_pct` (int, défaut 0), `is_active` (bool), `sort_order` (int), `stripe_price_id` (text), timestamps. **Credits accordés = `credits + round(credits * bonus_pct / 100)`** (le bonus §1.1 est un supplément additif, pas inclus dans `credits`). Le calcul vit dans le handler webhook, testé.

### `subscription_plans` (sous-projet B)

`id`, `name`, `interval` (`month` en V1 ; `year` réservé), `price_cents`, `currency`, `credits_per_period` (int), `rollover_cap` (int, 0 = pas de rollover), `features` (text/jsonb, description avantages), `is_active`, `sort_order`, `stripe_price_id`, timestamps.

### `network_billing` (sous-projet B)

`network_id` (PK, FK networks cascade), `stripe_customer_id`, `stripe_subscription_id` nullable, `plan_id` (FK subscription_plans) nullable, `status` (`active \| past_due \| grace \| canceled` — null/absent = pas d'abo), `current_period_end` timestamp nullable, `grace_until` timestamp nullable, timestamps. `networks.tier` reste un flag dénormalisé (`free`/plan slug) mis à jour par le webhook.

### `credit_purchases` (audit top-ups, sous-projet B)

`id`, `network_id` (FK), `pack_id` (FK, nullable si pack supprimé), `stripe_session_id`, `stripe_invoice_url` nullable, `amount_cents`, `currency`, `credits` (accordés), `created_by` (FK users, le membre acheteur), `created_at`. Sert l'historique §1.3 (les factures elles-mêmes vivent dans Stripe, on stocke l'URL).

### `stripe_events` (idempotence webhooks, sous-projet B)

`event_id` (PK, l'`id` de l'événement Stripe), `type`, `processed_at`. Un webhook déjà vu (même `event_id`) est ignoré.

## Ordre de débit & rollover (sous-projet A)

**Débit (§4.1).** `recordDebitedTurn` (aujourd'hui : une entrée `debit` unique) devient : calculer le solde disponible par bucket (`subscription`, `rollover`, `topup`), puis marcher dans cet ordre en ponctionnant jusqu'à couvrir le total dû — insérer **une entrée négative par bucket ponctionné**, taguée `bucket`, la somme = credits dus. Le pre-check du tour lit le **solde total** (déjà en place, `getBalance` → somme des 3 buckets non expirés). Aucun débit sur erreur provider (déjà en place). Nouvel accès `getBucketBalances(networkId)` → `{ subscription, rollover, topup, total, subscriptionQuota, periodEnd }` pour l'indicateur.

**Rollover / renouvellement (§2.2, déclenché par le webhook `invoice.paid` d'abo, sous-projet B mais logique dans A).** En une transaction append-only :
1. Le restant du bucket `subscription` de la période close bascule en `rollover`, plafonné à `rollover_cap` du plan (entrées : un débit du reste subscription + un crédit rollover à hauteur du min(reste, cap)).
2. Le surplus au-delà du cap est simplement laissé expirer (l'`expires_at` de la période close est atteint).
3. Un nouveau lot `subscription` de `credits_per_period` est crédité, `expires_at` = fin de la nouvelle période, `period_id` = nouvelle période.

**Expiration.** Aucune entrée n'est supprimée ; le solde d'un bucket exclut simplement les entrées `expires_at <= now()`. Un bucket `subscription` expiré cesse de compter dès la fin de période sans job (lecture-time).

## Flux Stripe (sous-projet B)

- **Top-up.** `POST /api/v1/billing/checkout/pack` `{ packId, projectId|networkId }` → crée une **Checkout Session** (mode `payment`, ligne = `stripe_price_id` du pack) → renvoie l'URL. Retour succès → `checkout.session.completed` (webhook) → écrit `credit_purchases` + une entrée ledger `bucket=topup`, `reason=grant`. Idempotent via `stripe_events`.
- **Souscription.** `POST /api/v1/billing/checkout/subscription` `{ planId, networkId }` → Checkout Session mode `subscription` → URL. `checkout.session.completed` + `invoice.paid` (première période) → crée/maj `network_billing` (`active`, `current_period_end`), crédite le lot `subscription`, met `networks.tier`.
- **Renouvellements.** `invoice.paid` récurrent → rollover + nouveau lot `subscription` (logique §rollover ci-dessus).
- **Échec de paiement (§2.5).** `invoice.payment_failed` → `status=past_due` puis `grace` avec `grace_until = now + grace_days` (config admin). Passé le délai (`customer.subscription.updated` status unpaid/canceled, ou vérif lecture-time) → plus de renouvellement de credits ; les credits déjà disponibles restent utilisables. Emails d'échec/rappel = natifs Stripe.
- **Changement / annulation.** `customer.subscription.updated`/`deleted` → maj `plan_id`/`status`/`current_period_end`. À l'annulation, accès jusqu'à `current_period_end` ; rollover + top-up conservés.
- **Gestion.** `POST /api/v1/billing/portal` → **Billing Portal Session** → URL (changer formule, moyen de paiement, annuler, télécharger factures).
- **Sécurité webhook :** vérification de signature (`STRIPE_WEBHOOK_SECRET`), endpoint public non-authentifié dédié, idempotence `stripe_events`.

Variables d'env : `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PUBLISHABLE_KEY` (front, si besoin), `BILLING_SUCCESS_URL`/`BILLING_CANCEL_URL` (retours Checkout), `BILLING_GRACE_DAYS` (défaut 7). Documentées dans `.env.example` + CLAUDE.md.

## UI (sous-projet C)

Design-system-first (`components/ui` + tokens), i18n en+fr, mobile-friendly.

- **`CreditIndicator`** — barre segmentée (quota abo consommé du mois) + total numérique + contexte (« sur X ce mois-ci » si abo actif) + états couleur (jaune <20 % du quota, rouge <5 %, zéro) + popover : abo restant ce mois, date de renouvellement, top-up permanent, conso récente 7j, CTA recharger/gérer. Consomme `GET /api/v1/ai/balance` étendu en `GET /api/v1/billing/balance` → `getBucketBalances`. Remplace/augmente le `BalanceChip` du composer assistant.
- **`/credits`** (remplace le placeholder) — grille de packs (bouton acheter → Checkout), cartes de formules (souscrire → Checkout), section « Mon abonnement » (formule active + date renouvellement + « Gérer » → Customer Portal), historique achats + liens factures (`credit_purchases` + Stripe). Solde à zéro → message clair + ces mêmes CTA. Le composer bloqué (402, déjà en place) route son CTA vers cette page.

## Admin (sous-projet D)

> **LIVRÉ 2026-07-04** (branche `feat/billing-D-admin`). Page `/admin/billing` (Tabs Ventes/Packs/Abonnements/Grant), endpoints `GET /api/v1/admin/billing/sales` + `POST /api/v1/admin/billing/grant`. CA top-up **par devise** (pas de somme cross-devise), abonnés actifs/formule dérivés du statut. Churn/ARPU/MRR restent V1.5. Plan : `docs/superpowers/plans/2026-07-04-billing-D-admin.md`.

`/admin/billing` : CRUD packs + formules (créer/éditer = provisionne le product/price Stripe via API ; désactiver plutôt que supprimer). Suivi ventes : CA par période (7j/30j/custom, top-ups vs abos, depuis `credit_purchases` + statut abo), nb d'abonnés actifs par formule. Grant manuel (bucket `topup`, `reason=adjustment`, `note` = motif — s'appuie sur la route de grant existante étendue). Analytics churn/ARPU/MRR = V1.5.

## Tests

- **A** : ordre de débit multi-buckets, expiration lecture-time, plafond rollover, transaction de renouvellement, `getBucketBalances`. Unitaires backend (`bun run test`).
- **B** : provisioning Stripe (mock SDK), création Checkout/Portal, handler webhooks avec events fixtures (`checkout.session.completed`, `invoice.paid` initial + récurrent, `payment_failed`, `subscription.updated/deleted`) + idempotence `stripe_events`, guards admin, sécurité signature.
- **C/D** : composants indicateur (états couleur, popover, breakdown), page `/credits`, admin billing (CRUD, suivi), i18n en+fr.

## Docs impactées

`docs/architecture/entities.md` (buckets + tables billing), `rest-endpoints.md` (`/billing/*`), `CHANGELOG.md`, `.env.example` + CLAUDE.md (env Stripe), `docs/architecture/ws-protocol.md` (non concerné), docs-site (page user achat/abo), `2026-07-02-ai-model-system-design.md` (note : `/credits` réalisé).
