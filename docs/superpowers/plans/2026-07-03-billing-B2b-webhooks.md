# Billing — Plan B2b : Webhooks Stripe (fulfillment money-path)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Créditer réellement les buckets d'un network quand un paiement Stripe aboutit — top-up ponctuel, première période d'abonnement, renouvellements récurrents (avec rollover) — et gérer le cycle de vie de l'abonnement (échec de paiement → grâce, changement/annulation), le tout idempotent et résolu par `metadata.networkId`.

**Architecture:** Un endpoint public `POST /billing/webhook` lit le raw body, vérifie la signature via `StripeGateway.constructWebhookEvent` (mockable), déduplique par `stripe_events.event_id`, puis dispatche vers `handleStripeEvent(event)` — une fonction testable en isolation qui écrit en DB. Le fulfillment top-up appelle `grantCredits(topup)` + insère `credit_purchases` ; l'abonnement s'appuie sur `renewSubscriptionPeriod` (durci en T2 pour zéro-er la période close, timing-indépendant) et sur `network_billing` (nouvelle colonne `current_period_id`). Le network cible est TOUJOURS résolu par `metadata.networkId`, jamais par un lookup customer-id.

**Tech Stack:** Bun + Hono + Drizzle + `stripe` SDK. Tests `bun:test` via `bun run test` (JAMAIS `bun test` direct), events fabriqués + gateway injectée en fake.

## Global Constraints

- Spec : `docs/superpowers/specs/2026-07-03-billing-subscriptions-topups-design.md` (§2.2 rollover, §2.5 grace, §4.1 buckets, §4.3 débit atomique). Facturation **per-network**.
- **Idempotence** : tout event déjà vu (même `event_id`) est ignoré (`stripe_events`). Le fulfillment top-up a une 2e ceinture via l'index unique `credit_purchases_session_uniq`.
- Le network cible se résout par **`metadata.networkId`** (posé au checkout, copié sur `subscription_data.metadata`) — jamais par lookup Stripe customer-id.
- **Aucun appel Stripe réel dans les tests** : `constructWebhookEvent` du fake renvoie l'event fourni (pas de vérif signature). La clé `STRIPE_WEBHOOK_SECRET` n'est lue que par l'implémentation réelle.
- **Timing renouvellement (A-carry)** : `renewSubscriptionPeriod` doit zéro-er la période close (entrée compensatoire taguée avec l'`expires_at` de la période close) pour que le solde soit correct MÊME si le webhook `invoice.paid` arrive avant l'expiration du grant de clôture. C'est la Task 2.
- **Débit/crédit atomique** : chaque fulfillment (grant + purchase, ou renewal) en une transaction ; erreur → l'event n'est pas marqué processed (Stripe retentera).
- Top-up : credits accordés = `creditsForPack(pack)` (bonus inclus). Grace : `graceUntil = now + BILLING_GRACE_DAYS` (défaut 7).
- Webhook route **publique** (pas de `userAuth`) — montée AVANT le `app.use("/api/v1/billing/*", userAuth())` OU sur un chemin non couvert par ce middleware (voir Task 4).
- Migration Drizzle générée + committée. `cd backend && bun run test`. Typecheck billing : `cd backend && node node_modules/typescript/bin/tsc --noEmit --skipLibCheck 2>&1 | grep "modules/billing"` doit être vide (`npx tsc` = stub, ne pas s'y fier). Commits conventional. Stage explicite — jamais `git add -A` (WIP `backend/src/routes/link.ts`, `.agents/`, `AGENTS.md`).

## Interfaces existantes consommées

- `grantCredits({ networkId, amount, bucket, expiresAt?, periodId?, reason?, note? })`, `renewSubscriptionPeriod({ networkId, creditsPerPeriod, rolloverCap, closingPeriodId?, newPeriodId, newPeriodEnd, now? })`, `getBucketBalances` — `../ai/creditsRepo` / `../ai/subscriptionCredits`.
- `getPack` (`packsRepo`), `getPlan`/`listPlans` (`plansRepo`), `creditsForPack` (`packsRepo`).
- `getNetworkBilling` (`networkBillingRepo`), tables `networkBilling`/`creditPurchases`/`stripeEvents`/`subscriptionPlans`/`networks`.
- `StripeGateway` + `getStripeGateway`/`__setStripeGatewayForTests` (`stripe.ts`).

---

### Task 1: Colonne `network_billing.current_period_id` + migration

**Files:**
- Modify: `backend/src/db/schema.ts` (table `networkBilling`)
- Create: `backend/drizzle/00NN_*.sql`
- Modify: `docs/architecture/entities.md`

**Interfaces:**
- Produces: `networkBilling.currentPeriodId` (text nullable) — le `periodId` de la période d'abo en cours ; le webhook `invoice.paid` récurrent le passe comme `closingPeriodId` à `renewSubscriptionPeriod` puis le met à jour.

- [ ] **Step 1: Ajouter la colonne**

Dans `schema.ts`, table `networkBilling`, après `graceUntil` :

```ts
		// periodId of the current subscription period (Stripe invoice/period id).
		// The recurring invoice.paid webhook passes it as renewSubscriptionPeriod's
		// closingPeriodId, then overwrites it with the new period.
		currentPeriodId: text("current_period_id"),
```

- [ ] **Step 2: Générer la migration**

Run: `cd backend && bun run db:generate`
Expected: `ALTER TABLE "network_billing" ADD COLUMN "current_period_id"`.

- [ ] **Step 3: Suite verte**

Run: `cd backend && bun run test`
Expected: PASS (additif).

- [ ] **Step 4: entities.md** — compléter la ligne `network_billing` : ajouter `current_period_id` (periodId de la période d'abo courante, pour le rollover au renouvellement).

- [ ] **Step 5: Commit**

```bash
git add backend/src/db/schema.ts backend/drizzle/ docs/architecture/entities.md
git commit -m "feat(backend): network_billing.current_period_id for renewal tracking"
```

---

### Task 2: Durcir `renewSubscriptionPeriod` — zéro-er la période close (timing-indépendant)

**Files:**
- Modify: `backend/src/modules/ai/subscriptionCredits.ts`
- Test: `backend/src/modules/ai/subscriptionCredits.test.ts` (étendre)

**Interfaces:**
- Consumes: table `aiCreditLedger`.
- Produces: `renewSubscriptionPeriod` inchangé côté signature/retour, mais écrit désormais une entrée compensatoire `-leftover` sur la période close, taguée avec l'`expires_at` de la période close (récupéré en tx), de sorte que le bucket `subscription` soit correct **même si le webhook arrive avant l'expiration du grant de clôture** (plus de double-comptage `[renewal, expiry)`).

- [ ] **Step 1: Écrire le test (prouve le no-double-count avant expiration)**

Dans `subscriptionCredits.test.ts` :

```ts
	it("zeroes the closing period at renewal even when its grant has NOT expired yet (no double count)", async () => {
		const net = (await createNetwork("renew-nodouble")).id;
		const future = new Date("2999-01-01T00:00:00Z"); // closing grant NOT expired at renewal
		const nextEnd = new Date("2999-06-01T00:00:00Z");
		try {
			// closing period pA: 100 granted (exp future), 30 consumed → leftover 70
			await db.insert(aiCreditLedger).values([
				{ id: crypto.randomUUID(), networkId: net, delta: 100, reason: "grant", bucket: "subscription", expiresAt: future, periodId: "pA", createdAt: new Date() },
				{ id: crypto.randomUUID(), networkId: net, delta: -30, reason: "debit", bucket: "subscription", expiresAt: future, periodId: "pA", createdAt: new Date() },
			]);
			await renewSubscriptionPeriod({ networkId: net, creditsPerPeriod: 500, rolloverCap: 30, closingPeriodId: "pA", newPeriodId: "pB", newPeriodEnd: nextEnd });
			const b = await getBucketBalances(net);
			// Without zeroing: pA (70, not expired) + pB (500) = 570 subscription → WRONG.
			// With zeroing: pA nets to 0 now → subscription = 500, rollover = 30.
			expect(b.subscription).toBe(500);
			expect(b.rollover).toBe(30);
		} finally {
			await db.delete(aiCreditLedger).where(eq(aiCreditLedger.networkId, net));
			await db.delete(networks).where(eq(networks.id, net));
		}
	});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `cd backend && bun run test src/modules/ai/subscriptionCredits.test.ts`
Expected: FAIL — `b.subscription` vaut 570 (pA leftover non zéro-é coexiste avec pB).

- [ ] **Step 3: Implémenter le zeroing**

Dans `renewSubscriptionPeriod`, à l'intérieur de la transaction, dans le bloc `if (input.closingPeriodId)` : après avoir calculé `leftover`/`rolledOver`, récupérer l'`expiresAt` du grant de la période close et écrire l'entrée compensatoire. Remplacer le bloc `if (input.closingPeriodId) { ... }` par :

```ts
		if (input.closingPeriodId) {
			const [row] = await tx
				.select({ sum: sql<number>`coalesce(sum(${aiCreditLedger.delta}), 0)::int` })
				.from(aiCreditLedger)
				.where(and(
					eq(aiCreditLedger.networkId, input.networkId),
					eq(aiCreditLedger.bucket, "subscription"),
					eq(aiCreditLedger.periodId, input.closingPeriodId),
				));
			const leftover = Math.max(row?.sum ?? 0, 0);
			rolledOver = Math.min(leftover, Math.max(input.rolloverCap, 0));
			// Zero the closing period NOW so the new period doesn't double-count
			// while the closing grant is still non-expired. Tag the compensating
			// entry with the closing period's own expiry so it also nets out of the
			// SUM after expiry (no lingering negative).
			if (leftover > 0) {
				const [grant] = await tx
					.select({ expiresAt: aiCreditLedger.expiresAt })
					.from(aiCreditLedger)
					.where(and(
						eq(aiCreditLedger.networkId, input.networkId),
						eq(aiCreditLedger.bucket, "subscription"),
						eq(aiCreditLedger.periodId, input.closingPeriodId),
						sql`${aiCreditLedger.delta} > 0`,
					))
					.limit(1);
				await tx.insert(aiCreditLedger).values({
					id: crypto.randomUUID(), networkId: input.networkId, delta: -leftover,
					reason: "adjustment", bucket: "subscription", periodId: input.closingPeriodId,
					expiresAt: grant?.expiresAt ?? null, note: "period close", createdAt: now,
				});
			}
		}
```

- [ ] **Step 4: Run — expect PASS + les tests existants**

Run: `cd backend && bun run test src/modules/ai/subscriptionCredits.test.ts`
Expected: PASS (le nouveau + les anciens — les tests existants utilisent des grants expirés/future ; le zeroing ne change pas leur résultat net : cap-0 → leftover 0 → pas de compensation ; cas expiré → leftover period-scoped inchangé, compensation taguée à l'expiry passée donc déjà exclue).

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/ai/subscriptionCredits.ts backend/src/modules/ai/subscriptionCredits.test.ts
git commit -m "fix(backend): renewal zeroes the closing period (timing-independent, no double count)"
```

---

### Task 3: `constructWebhookEvent` + config

**Files:**
- Modify: `backend/src/modules/billing/stripe.ts`
- Test: `backend/src/modules/billing/stripe.test.ts` (étendre)

**Interfaces:**
- Produces: `StripeGateway` gagne `constructWebhookEvent(rawBody: string, signature: string): StripeWebhookEvent` où `interface StripeWebhookEvent { id: string; type: string; data: { object: Record<string, unknown> } }`. La real impl appelle `stripe.webhooks.constructEvent(rawBody, signature, secret)` (throw si signature invalide) ; le fake renvoie un event pré-fabriqué. `STRIPE_WEBHOOK_SECRET` lue uniquement dans la real impl.

- [ ] **Step 1: Écrire le test**

```ts
	it("a fake constructWebhookEvent returns the injected event; real path reads the secret", async () => {
		const ev = { id: "evt_1", type: "checkout.session.completed", data: { object: { foo: "bar" } } };
		__setStripeGatewayForTests({
			async createProductWithPrice() { return { productId: "p", priceId: "pr" }; },
			async createPriceForProduct() { return { priceId: "pr2" }; },
			async updateProductName() {},
			async archivePrice() {},
			async createCustomer() { return { customerId: "c" }; },
			async createCheckoutSession() { return { url: "u" }; },
			async createPortalSession() { return { url: "u" }; },
			constructWebhookEvent() { return ev; },
		});
		expect(getStripeGateway().constructWebhookEvent("raw", "sig")).toBe(ev);
	});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `cd backend && bun run test src/modules/billing/stripe.test.ts`
Expected: FAIL — `constructWebhookEvent` absent de l'interface.

- [ ] **Step 3: Implémenter**

Dans `stripe.ts` : ajouter le type + la méthode à l'interface :

```ts
export interface StripeWebhookEvent {
	id: string;
	type: string;
	data: { object: Record<string, unknown> };
}
```
Ajouter à `interface StripeGateway` : `constructWebhookEvent(rawBody: string, signature: string): StripeWebhookEvent;`.
Dans `RealStripeGateway` :

```ts
	constructWebhookEvent(rawBody: string, signature: string): StripeWebhookEvent {
		const secret = process.env.STRIPE_WEBHOOK_SECRET;
		if (!secret) throw new Error("STRIPE_WEBHOOK_SECRET is not set");
		return this.stripe.webhooks.constructEvent(rawBody, signature, secret) as unknown as StripeWebhookEvent;
	}
```

(Compléter TOUS les fakes des tests billing existants avec `constructWebhookEvent` sinon TS casse — grep `StripeGateway = {` dans `src/modules/billing/*.test.ts` et ajouter une stub `constructWebhookEvent() { return { id: "", type: "", data: { object: {} } }; }` à chacun.)

- [ ] **Step 4: Run — expect PASS + tsc billing clean**

Run: `cd backend && bun run test src/modules/billing/stripe.test.ts`
Expected: PASS.
Run: `cd backend && node node_modules/typescript/bin/tsc --noEmit --skipLibCheck 2>&1 | grep "modules/billing"`
Expected: vide.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/billing/stripe.ts backend/src/modules/billing/*.test.ts
git commit -m "feat(backend): Stripe webhook event construction (signature-verified, mockable)"
```

---

### Task 4: Route webhook + idempotence + dispatcher + `checkout.session.completed`

**Files:**
- Create: `backend/src/modules/billing/webhookHandler.ts` (dispatcher + handlers, testable sans HTTP)
- Create: `backend/src/modules/billing/webhookRoutes.ts` (`buildBillingWebhookRouter`)
- Modify: `backend/src/app.ts` (monter la route webhook PUBLIQUE, hors `userAuth`)
- Test: `backend/src/modules/billing/webhook.test.ts`

**Interfaces:**
- Consumes: `getStripeGateway`, `getPack`/`creditsForPack`, tables `stripeEvents`/`creditPurchases`/`networkBilling`, `grantCredits`.
- Produces:
  - `handleStripeEvent(event: StripeWebhookEvent): Promise<void>` — idempotent (insère `stripe_events` en début ; si conflit → return sans retraiter), dispatch par `event.type`. En T4 : `checkout.session.completed`. Les autres types inconnus sont ignorés (loggés).
  - `buildBillingWebhookRouter(): Hono` — `POST /webhook` : lit `await c.req.text()` (raw), header `stripe-signature`, `getStripeGateway().constructWebhookEvent(raw, sig)` (400 si throw), `handleStripeEvent(event)`, renvoie `{ received: true }`.
  - `checkout.session.completed` handler : `session = event.data.object` ; `md = session.metadata` ; `networkId = md.networkId`.
    - `md.kind === "pack"` : resolve `getPack(md.packId)` ; en une transaction : `grantCredits({ networkId, amount: creditsForPack(pack), bucket: "topup", reason: "grant", note: "top-up" })` + insert `creditPurchases` (`stripeSessionId: session.id`, `amountCents: session.amount_total ?? pack.priceCents`, `currency`, `credits: creditsForPack(pack)`, `createdBy: md.userId`). L'index unique sur `stripe_session_id` = 2e ceinture.
    - `md.kind === "subscription"` : upsert `network_billing` (networkId) avec `stripeCustomerId: session.customer`, `stripeSubscriptionId: session.subscription`, `planId: md.planId` (le grant de credits arrive à `invoice.paid`, T5).

- [ ] **Step 1: Écrire les tests**

`backend/src/modules/billing/webhook.test.ts` (fixtures : network + un pack topup credits 500 bonus 20 → 600 ; fake gateway dont `constructWebhookEvent` renvoie l'event passé au POST) :

```ts
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { app } from "../../app";
import { db } from "../../db/index";
import { aiCreditLedger, creditPacks, creditPurchases, networkBilling, networks, stripeEvents, users } from "../../db/schema";
import { createNetwork } from "../../lib/networkManager";
import { getBucketBalances } from "../ai/creditsRepo";
import { __setStripeGatewayForTests, type StripeGateway, type StripeWebhookEvent } from "./stripe";

let networkId = "";
let packId = "";
const USER_ID = "usr_wh";

let nextEvent: StripeWebhookEvent = { id: "", type: "", data: { object: {} } };
function fake(): StripeGateway {
	return {
		async createProductWithPrice() { return { productId: "p", priceId: "pr" }; },
		async createPriceForProduct() { return { priceId: "pr2" }; },
		async updateProductName() {}, async archivePrice() {},
		async createCustomer() { return { customerId: "c" }; },
		async createCheckoutSession() { return { url: "u" }; },
		async createPortalSession() { return { url: "u" }; },
		constructWebhookEvent() { return nextEvent; },
	};
}

/** POST an event to the webhook (fake gateway returns `ev` from constructWebhookEvent). */
async function post(ev: StripeWebhookEvent) {
	nextEvent = ev;
	return app.request("/api/v1/billing/webhook", { method: "POST", headers: { "stripe-signature": "sig" }, body: "{}" });
}

beforeAll(async () => {
	networkId = (await createNetwork("wh-net")).id;
	const now = new Date();
	await db.insert(users).values({ id: USER_ID, email: "wh@example.com", name: "wh", createdAt: now, updatedAt: now }).onConflictDoNothing();
	packId = crypto.randomUUID();
	await db.insert(creditPacks).values({ id: packId, name: "P", priceCents: 1000, currency: "eur", credits: 500, bonusPct: 20, isActive: true, sortOrder: 0, stripeProductId: "prod", stripePriceId: "price", createdAt: now, updatedAt: now });
	__setStripeGatewayForTests(fake());
});

afterEach(async () => {
	await db.delete(stripeEvents);
	await db.delete(creditPurchases).where(eq(creditPurchases.networkId, networkId));
	await db.delete(aiCreditLedger).where(eq(aiCreditLedger.networkId, networkId));
	await db.delete(networkBilling).where(eq(networkBilling.networkId, networkId));
});

afterAll(async () => {
	__setStripeGatewayForTests(null);
	await db.delete(creditPacks).where(eq(creditPacks.id, packId));
	await db.delete(networks).where(eq(networks.id, networkId));
	await db.delete(users).where(eq(users.id, USER_ID));
});

describe("webhook checkout.session.completed", () => {
	it("pack purchase grants topup credits (with bonus) + records a purchase", async () => {
		const res = await post({
			id: "evt_pack_1", type: "checkout.session.completed",
			data: { object: { id: "cs_1", customer: "cus_1", amount_total: 1000, currency: "eur",
				metadata: { networkId, kind: "pack", packId, userId: USER_ID } } },
		});
		expect(res.status).toBe(200);
		expect((await getBucketBalances(networkId)).topup).toBe(600); // 500 + 20%
		const [purchase] = await db.select().from(creditPurchases).where(eq(creditPurchases.networkId, networkId));
		expect(purchase.credits).toBe(600);
		expect(purchase.stripeSessionId).toBe("cs_1");
	});

	it("is idempotent — replaying the same event id does not double-grant", async () => {
		const ev: StripeWebhookEvent = { id: "evt_pack_2", type: "checkout.session.completed",
			data: { object: { id: "cs_2", customer: "cus_1", amount_total: 1000, currency: "eur", metadata: { networkId, kind: "pack", packId, userId: USER_ID } } } };
		await post(ev);
		await post(ev); // replay
		expect((await getBucketBalances(networkId)).topup).toBe(600); // not 1200
	});

	it("subscription checkout links the customer/subscription/plan on network_billing (no grant yet)", async () => {
		const res = await post({
			id: "evt_sub_1", type: "checkout.session.completed",
			data: { object: { id: "cs_3", customer: "cus_9", subscription: "sub_9",
				metadata: { networkId, kind: "subscription", planId: "plan_x", userId: USER_ID } } },
		});
		expect(res.status).toBe(200);
		const [row] = await db.select().from(networkBilling).where(eq(networkBilling.networkId, networkId));
		expect(row.stripeSubscriptionId).toBe("sub_9");
		expect(row.stripeCustomerId).toBe("cus_9");
		expect(row.planId).toBe("plan_x");
		expect((await getBucketBalances(networkId)).subscription).toBe(0); // grant happens on invoice.paid
	});

	it("unknown event type → 200 received, no-op", async () => {
		const res = await post({ id: "evt_x", type: "customer.created", data: { object: {} } });
		expect(res.status).toBe(200);
	});
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `cd backend && bun run test src/modules/billing/webhook.test.ts`
Expected: FAIL — route 404.

- [ ] **Step 3: Implémenter `webhookHandler.ts`**

```ts
import { db } from "../../db/index";
import { creditPurchases, networkBilling, stripeEvents } from "../../db/schema";
import { grantCredits } from "../ai/creditsRepo";
import { getPack, creditsForPack } from "./packsRepo";
import type { StripeWebhookEvent } from "./stripe";

/** Idempotently process a verified Stripe event. Marks the event id processed
 *  FIRST (insert-on-conflict-do-nothing); if already present, returns without
 *  reprocessing. Unknown types are ignored. Throws on handler failure so the
 *  route returns non-2xx and Stripe retries (the event id stays unmarked). */
export async function handleStripeEvent(event: StripeWebhookEvent): Promise<void> {
	// Idempotency: claim the event id. If it already exists, skip.
	const claimed = await db
		.insert(stripeEvents)
		.values({ eventId: event.id, type: event.type, processedAt: new Date() })
		.onConflictDoNothing()
		.returning();
	if (claimed.length === 0) return; // already processed

	try {
		if (event.type === "checkout.session.completed") {
			await onCheckoutCompleted(event.data.object);
		}
		// other types added in T5/T6
	} catch (e) {
		// Undo the idempotency claim so Stripe's retry reprocesses this event.
		await db.delete(stripeEvents).where(eq(stripeEvents.eventId, event.id));
		throw e;
	}
}

import { and, eq } from "drizzle-orm";

async function onCheckoutCompleted(obj: Record<string, unknown>): Promise<void> {
	const md = (obj.metadata ?? {}) as Record<string, string>;
	const networkId = md.networkId;
	if (!networkId) return;

	if (md.kind === "pack") {
		const pack = await getPack(md.packId);
		if (!pack) return;
		const credits = creditsForPack(pack);
		const sessionId = typeof obj.id === "string" ? obj.id : null;
		await db.transaction(async (tx) => {
			await tx.insert(creditPurchases).values({
				id: crypto.randomUUID(),
				networkId,
				packId: pack.id,
				stripeSessionId: sessionId,
				amountCents: typeof obj.amount_total === "number" ? obj.amount_total : pack.priceCents,
				currency: typeof obj.currency === "string" ? obj.currency : pack.currency,
				credits,
				createdBy: md.userId ?? null,
				createdAt: new Date(),
			});
			await tx.insert((await import("../../db/schema")).aiCreditLedger).values({
				id: crypto.randomUUID(), networkId, delta: credits, reason: "grant",
				bucket: "topup", note: "top-up", createdBy: md.userId ?? null, createdAt: new Date(),
			});
		});
		return;
	}

	if (md.kind === "subscription") {
		const now = new Date();
		const existing = await db.select().from(networkBilling).where(eq(networkBilling.networkId, networkId));
		const patch = {
			stripeCustomerId: typeof obj.customer === "string" ? obj.customer : null,
			stripeSubscriptionId: typeof obj.subscription === "string" ? obj.subscription : null,
			planId: md.planId ?? null,
			updatedAt: now,
		};
		if (existing.length > 0) {
			await db.update(networkBilling).set(patch).where(eq(networkBilling.networkId, networkId));
		} else {
			await db.insert(networkBilling).values({ networkId, ...patch, createdAt: now });
		}
	}
}
```

Note : préférer un import top-level de `aiCreditLedger` (`import { aiCreditLedger } from "../../db/schema";`) plutôt que le `await import(...)` inline — le nettoyer à l'implémentation ; l'inline ci-dessus est illustratif, remplacer par l'import top-level et `tx.insert(aiCreditLedger)`. **Ne pas** laisser d'`import` au milieu du fichier : remonter `import { and, eq } from "drizzle-orm";` et `import { aiCreditLedger } from "../../db/schema";` en tête.

- [ ] **Step 4: Implémenter `webhookRoutes.ts`**

```ts
import { Hono } from "hono";
import { getStripeGateway } from "./stripe";
import { handleStripeEvent } from "./webhookHandler";

export function buildBillingWebhookRouter(): Hono {
	const r = new Hono();
	r.post("/webhook", async (c) => {
		const raw = await c.req.text();
		const sig = c.req.header("stripe-signature") ?? "";
		let event;
		try {
			event = getStripeGateway().constructWebhookEvent(raw, sig);
		} catch {
			return c.json({ error: "invalid_signature" }, 400);
		}
		await handleStripeEvent(event);
		return c.json({ received: true });
	});
	return r;
}
```

- [ ] **Step 5: Monter la route PUBLIQUE dans `app.ts`**

La route webhook ne doit PAS passer `userAuth()`. Le middleware `app.use("/api/v1/billing/*", userAuth())` couvre `/api/v1/billing/webhook`. Monter le router webhook **AVANT** cette ligne `app.use` :

```ts
import { buildBillingWebhookRouter } from "./modules/billing/webhookRoutes";
// ... (avant `app.use("/api/v1/billing/*", userAuth())`)
app.route("/api/v1/billing", buildBillingWebhookRouter());
app.use("/api/v1/billing/*", userAuth());
app.route("/api/v1/billing", buildBillingUserRouter());
```

(Hono évalue les routes dans l'ordre d'enregistrement : la route `/webhook` enregistrée avant le middleware `userAuth` matche en premier et court-circuite. Vérifier via le test « 200 sans session ».)

- [ ] **Step 6: Run — expect PASS + tsc billing clean**

Run: `cd backend && bun run test src/modules/billing/webhook.test.ts`
Expected: PASS.
Run: `cd backend && node node_modules/typescript/bin/tsc --noEmit --skipLibCheck 2>&1 | grep "modules/billing"`
Expected: vide.

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/billing/webhookHandler.ts backend/src/modules/billing/webhookRoutes.ts backend/src/app.ts backend/src/modules/billing/webhook.test.ts
git commit -m "feat(backend): Stripe webhook route + idempotency + checkout.session.completed fulfillment"
```

---

### Task 5: Handler `invoice.paid` (1re période + renouvellement)

**Files:**
- Modify: `backend/src/modules/billing/webhookHandler.ts`
- Test: `backend/src/modules/billing/webhook.test.ts` (étendre)

**Interfaces:**
- Consumes: `getNetworkBilling` (`networkBillingRepo`), `getPlan` (`plansRepo`), `renewSubscriptionPeriod` (`../ai/subscriptionCredits`), `grantCredits`, tables `networkBilling`/`networks`.
- Produces: `handleStripeEvent` dispatche `invoice.paid`. Handler `onInvoicePaid(obj)` :
  - Résout `networkId` : `md.networkId` (des metadata de l'invoice/subscription si présentes) sinon lookup `network_billing` par `stripe_subscription_id = obj.subscription`.
  - Résout le plan via `network_billing.planId` → `getPlan` (creditsPerPeriod, rolloverCap).
  - `periodEnd` = `new Date(obj.lines.data[0].period.end * 1000)` ; `newPeriodId` = `String(obj.id)` (id de l'invoice = unique par période).
  - `billing_reason === "subscription_create"` (1re facture) : `grantCredits({ networkId, amount: plan.creditsPerPeriod, bucket: "subscription", expiresAt: periodEnd, periodId: newPeriodId, reason: "grant", note: "subscription" })`. Sinon (récurrent) : `renewSubscriptionPeriod({ networkId, creditsPerPeriod: plan.creditsPerPeriod, rolloverCap: plan.rolloverCap, closingPeriodId: billing.currentPeriodId, newPeriodId, newPeriodEnd: periodEnd })`.
  - Met à jour `network_billing` : `status: "active"`, `currentPeriodEnd: periodEnd`, `currentPeriodId: newPeriodId`, `graceUntil: null` ; met `networks.tier` = plan.name (ou slug).

- [ ] **Step 1: Écrire les tests**

Dans `webhook.test.ts` (seeder un plan actif + un `network_billing` lié via un checkout subscription préalable, ou insérer directement) :

```ts
	it("invoice.paid (subscription_create) activates the subscription + grants the first period", async () => {
		const planId = crypto.randomUUID();
		await db.insert(subscriptionPlans).values({ id: planId, name: "Pro", interval: "month", priceCents: 2000, currency: "eur", creditsPerPeriod: 5000, rolloverCap: 1000, features: "", isActive: true, sortOrder: 0, stripeProductId: "prod_s", stripePriceId: "price_s", createdAt: new Date(), updatedAt: new Date() });
		await db.insert(networkBilling).values({ networkId, stripeCustomerId: "cus", stripeSubscriptionId: "sub_1", planId, createdAt: new Date(), updatedAt: new Date() });
		const periodEnd = Math.floor(new Date("2999-02-01T00:00:00Z").getTime() / 1000);
		const res = await post({
			id: "evt_inv_1", type: "invoice.paid",
			data: { object: { id: "inv_1", subscription: "sub_1", billing_reason: "subscription_create", lines: { data: [{ period: { end: periodEnd } }] } } },
		});
		expect(res.status).toBe(200);
		expect((await getBucketBalances(networkId)).subscription).toBe(5000);
		const [row] = await db.select().from(networkBilling).where(eq(networkBilling.networkId, networkId));
		expect(row.status).toBe("active");
		expect(row.currentPeriodId).toBe("inv_1");
		await db.delete(subscriptionPlans).where(eq(subscriptionPlans.id, planId));
	});

	it("invoice.paid (subscription_cycle) renews: rolls capped leftover + grants the new period", async () => {
		const planId = crypto.randomUUID();
		await db.insert(subscriptionPlans).values({ id: planId, name: "Pro", interval: "month", priceCents: 2000, currency: "eur", creditsPerPeriod: 5000, rolloverCap: 1000, features: "", isActive: true, sortOrder: 0, stripeProductId: "prod_s", stripePriceId: "price_s", createdAt: new Date(), updatedAt: new Date() });
		await db.insert(networkBilling).values({ networkId, stripeCustomerId: "cus", stripeSubscriptionId: "sub_2", planId, currentPeriodId: "inv_prev", status: "active", createdAt: new Date(), updatedAt: new Date() });
		// closing period inv_prev: 5000 granted, 4200 spent → leftover 800 (cap 1000 → roll 800)
		await db.insert(aiCreditLedger).values([
			{ id: crypto.randomUUID(), networkId, delta: 5000, reason: "grant", bucket: "subscription", expiresAt: new Date("2999-01-15"), periodId: "inv_prev", createdAt: new Date() },
			{ id: crypto.randomUUID(), networkId, delta: -4200, reason: "debit", bucket: "subscription", expiresAt: new Date("2999-01-15"), periodId: "inv_prev", createdAt: new Date() },
		]);
		const periodEnd = Math.floor(new Date("2999-02-15T00:00:00Z").getTime() / 1000);
		await post({ id: "evt_inv_2", type: "invoice.paid", data: { object: { id: "inv_next", subscription: "sub_2", billing_reason: "subscription_cycle", lines: { data: [{ period: { end: periodEnd } }] } } } });
		const b = await getBucketBalances(networkId);
		expect(b.subscription).toBe(5000); // closing zeroed, new granted
		expect(b.rollover).toBe(800);
		await db.delete(subscriptionPlans).where(eq(subscriptionPlans.id, planId));
	});
```

(Ajouter `subscriptionPlans` à l'import schema du test.)

- [ ] **Step 2: Run — expect FAIL**

Run: `cd backend && bun run test src/modules/billing/webhook.test.ts`
Expected: FAIL — `invoice.paid` non géré (subscription reste 0).

- [ ] **Step 3: Implémenter `onInvoicePaid`**

Ajouter dans `webhookHandler.ts` (imports en tête : `getNetworkBilling` de `./networkBillingRepo`, `getPlan` de `./plansRepo`, `renewSubscriptionPeriod` de `../ai/subscriptionCredits`, `networks` de schema) et brancher `else if (event.type === "invoice.paid") await onInvoicePaid(event.data.object);` dans le dispatcher :

```ts
async function onInvoicePaid(obj: Record<string, unknown>): Promise<void> {
	const subscriptionId = typeof obj.subscription === "string" ? obj.subscription : null;
	const md = (obj.metadata ?? {}) as Record<string, string>;
	// Resolve network: prefer metadata.networkId, else our stored subscription mapping.
	let billing = null as Awaited<ReturnType<typeof getNetworkBilling>>;
	let networkId = md.networkId ?? "";
	if (networkId) billing = await getNetworkBilling(networkId);
	if (!billing && subscriptionId) {
		const rows = await db.select().from(networkBilling).where(eq(networkBilling.stripeSubscriptionId, subscriptionId));
		billing = rows[0] ?? null;
		networkId = billing?.networkId ?? "";
	}
	if (!billing || !networkId || !billing.planId) return;
	const plan = await getPlan(billing.planId);
	if (!plan) return;

	const lines = (obj.lines as { data?: Array<{ period?: { end?: number } }> } | undefined)?.data ?? [];
	const endUnix = lines[0]?.period?.end;
	const periodEnd = endUnix ? new Date(endUnix * 1000) : new Date();
	const newPeriodId = typeof obj.id === "string" ? obj.id : crypto.randomUUID();
	const isFirst = obj.billing_reason === "subscription_create";

	await db.transaction(async () => {}); // (renewal/grant below run their own tx)
	if (isFirst) {
		await grantCredits({ networkId, amount: plan.creditsPerPeriod, bucket: "subscription", expiresAt: periodEnd, periodId: newPeriodId, reason: "grant", note: "subscription" });
	} else {
		await renewSubscriptionPeriod({ networkId, creditsPerPeriod: plan.creditsPerPeriod, rolloverCap: plan.rolloverCap, closingPeriodId: billing.currentPeriodId ?? null, newPeriodId, newPeriodEnd: periodEnd });
	}
	await db.update(networkBilling).set({
		status: "active", currentPeriodEnd: periodEnd, currentPeriodId: newPeriodId, graceUntil: null, updatedAt: new Date(),
	}).where(eq(networkBilling.networkId, networkId));
	await db.update(networks).set({ tier: plan.name, updatedAt: new Date() }).where(eq(networks.id, networkId));
}
```

(Retirer la ligne `await db.transaction(async () => {});` — elle est un no-op laissé par erreur ; les grant/renew gèrent leur propre transaction.)

- [ ] **Step 4: Run — expect PASS + tsc billing clean**

Run: `cd backend && bun run test src/modules/billing/webhook.test.ts`
Expected: PASS.
Run: `cd backend && node node_modules/typescript/bin/tsc --noEmit --skipLibCheck 2>&1 | grep "modules/billing"`
Expected: vide.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/billing/webhookHandler.ts backend/src/modules/billing/webhook.test.ts
git commit -m "feat(backend): invoice.paid fulfillment (first period grant + recurring renewal)"
```

---

### Task 6: Cycle de vie — `payment_failed` (grâce) + `subscription.updated/deleted`

**Files:**
- Modify: `backend/src/modules/billing/webhookHandler.ts`
- Test: `backend/src/modules/billing/webhook.test.ts` (étendre)

**Interfaces:**
- Produces: dispatch de 3 types de plus :
  - `invoice.payment_failed` : `status: "past_due"` puis `graceUntil = now + BILLING_GRACE_DAYS` (env, défaut 7) ; les credits existants restent (aucun débit). Résolu par subscription id → network_billing.
  - `customer.subscription.updated` : `status` = mappé de `obj.status` (`active`→active, `past_due`→past_due, `canceled`→canceled, `unpaid`→canceled) ; `currentPeriodEnd = new Date(obj.current_period_end*1000)` ; si `obj.cancel_at_period_end` true → laisser actif jusqu'à la fin (status active, l'annulation effective viendra via `deleted`).
  - `customer.subscription.deleted` : `status: "canceled"` ; `networks.tier = "free"`. Les credits déjà disponibles + rollover + top-up restent.
  - Résolution network par subscription id (les 3 events portent `obj.id` = subscription id ou `obj.subscription`).

- [ ] **Step 1: Écrire les tests**

```ts
	it("payment_failed sets past_due + a grace window", async () => {
		await db.insert(networkBilling).values({ networkId, stripeSubscriptionId: "sub_f", status: "active", createdAt: new Date(), updatedAt: new Date() });
		await post({ id: "evt_fail", type: "invoice.payment_failed", data: { object: { subscription: "sub_f" } } });
		const [row] = await db.select().from(networkBilling).where(eq(networkBilling.networkId, networkId));
		expect(row.status).toBe("past_due");
		expect(row.graceUntil).not.toBeNull();
	});

	it("subscription.deleted cancels + resets tier to free", async () => {
		await db.insert(networkBilling).values({ networkId, stripeSubscriptionId: "sub_d", status: "active", createdAt: new Date(), updatedAt: new Date() });
		await db.update(networks).set({ tier: "Pro" }).where(eq(networks.id, networkId));
		await post({ id: "evt_del", type: "customer.subscription.deleted", data: { object: { id: "sub_d" } } });
		const [row] = await db.select().from(networkBilling).where(eq(networkBilling.networkId, networkId));
		expect(row.status).toBe("canceled");
		const [net] = await db.select().from(networks).where(eq(networks.id, networkId));
		expect(net.tier).toBe("free");
	});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `cd backend && bun run test src/modules/billing/webhook.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implémenter les 3 handlers + dispatch**

Ajouter au dispatcher : `else if (event.type === "invoice.payment_failed") await onPaymentFailed(event.data.object);`, `else if (event.type === "customer.subscription.updated") await onSubscriptionUpdated(event.data.object);`, `else if (event.type === "customer.subscription.deleted") await onSubscriptionDeleted(event.data.object);`

```ts
async function billingBySubscription(subscriptionId: string | null) {
	if (!subscriptionId) return null;
	const rows = await db.select().from(networkBilling).where(eq(networkBilling.stripeSubscriptionId, subscriptionId));
	return rows[0] ?? null;
}

async function onPaymentFailed(obj: Record<string, unknown>): Promise<void> {
	const b = await billingBySubscription(typeof obj.subscription === "string" ? obj.subscription : null);
	if (!b) return;
	const graceDays = Number(process.env.BILLING_GRACE_DAYS ?? 7);
	const graceUntil = new Date(Date.now() + graceDays * 24 * 3600 * 1000);
	await db.update(networkBilling).set({ status: "past_due", graceUntil, updatedAt: new Date() }).where(eq(networkBilling.networkId, b.networkId));
}

const STATUS_MAP: Record<string, string> = { active: "active", past_due: "past_due", canceled: "canceled", unpaid: "canceled", trialing: "active" };

async function onSubscriptionUpdated(obj: Record<string, unknown>): Promise<void> {
	const b = await billingBySubscription(typeof obj.id === "string" ? obj.id : null);
	if (!b) return;
	const status = STATUS_MAP[String(obj.status)] ?? b.status ?? "active";
	const end = typeof obj.current_period_end === "number" ? new Date(obj.current_period_end * 1000) : b.currentPeriodEnd;
	await db.update(networkBilling).set({ status, currentPeriodEnd: end, updatedAt: new Date() }).where(eq(networkBilling.networkId, b.networkId));
}

async function onSubscriptionDeleted(obj: Record<string, unknown>): Promise<void> {
	const b = await billingBySubscription(typeof obj.id === "string" ? obj.id : null);
	if (!b) return;
	await db.update(networkBilling).set({ status: "canceled", updatedAt: new Date() }).where(eq(networkBilling.networkId, b.networkId));
	await db.update(networks).set({ tier: "free", updatedAt: new Date() }).where(eq(networks.id, b.networkId));
}
```

- [ ] **Step 4: Run — expect PASS + suite complète + tsc**

Run: `cd backend && bun run test src/modules/billing/webhook.test.ts`
Expected: PASS.
Run: `cd backend && bun run test`
Expected: PASS.
Run: `cd backend && node node_modules/typescript/bin/tsc --noEmit --skipLibCheck 2>&1 | grep "modules/billing"`
Expected: vide.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/billing/webhookHandler.ts backend/src/modules/billing/webhook.test.ts
git commit -m "feat(backend): subscription lifecycle webhooks (grace, update, cancel)"
```

---

### Task 7: Docs

**Files:**
- Modify: `docs/architecture/rest-endpoints.md`, `docs/architecture/entities.md`, `CHANGELOG.md`, `.env.example`, `CLAUDE.md`

- [ ] **Step 1: rest-endpoints.md**

```markdown
| `/api/v1/billing/webhook` | Webhook Stripe (public, signature-vérifié, idempotent) : fulfillment top-up + cycle de vie abonnement (crédit des buckets, grâce, annulation) | `backend/src/modules/billing/webhookRoutes.ts` |
```

- [ ] **Step 2: entities.md** — note : `stripe_events` = idempotence webhooks (event_id PK) ; `network_billing.status`/`current_period_id`/`grace_until` pilotés par les webhooks.

- [ ] **Step 3: CHANGELOG** — `[Unreleased] ### Added` :

```markdown
- Billing webhooks (Stripe fulfillment): `POST /api/v1/billing/webhook` (public, signature-verified, idempotent via `stripe_events`). Top-up → topup credits + purchase record; `invoice.paid` → first-period grant / capped renewal (`renewSubscriptionPeriod` now zeroes the closing period, timing-independent); `payment_failed` → grace window; `subscription.updated/deleted` → status/tier. Network resolved by `metadata.networkId`.
```

- [ ] **Step 4: .env.example** — ajouter `BILLING_GRACE_DAYS=7` (sous le bloc Stripe). `STRIPE_WEBHOOK_SECRET` est déjà présent (B1).

- [ ] **Step 5: CLAUDE.md** — table env : ajouter `BILLING_GRACE_DAYS` (jours de grâce après échec de paiement avant suspension de l'abo ; défaut 7).

- [ ] **Step 6: Suite complète finale**

Run: `cd backend && bun run test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add docs/architecture/rest-endpoints.md docs/architecture/entities.md CHANGELOG.md .env.example CLAUDE.md
git commit -m "docs: billing webhooks (fulfillment, grace, idempotency)"
```
