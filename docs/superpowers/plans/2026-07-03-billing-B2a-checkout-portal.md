# Billing — Plan B2a : Checkout + Portal + routes read user (flux paiement sortant)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Envoyer un membre owner d'un network vers les pages hébergées Stripe (Checkout pour acheter un pack ou souscrire une formule, Customer Portal pour gérer son abo) et exposer les routes read que l'indicateur de credits + la page `/credits` consommeront. Le fulfillment (crédit des buckets) reste au webhook (= B2b).

**Architecture:** On grossit `StripeGateway` (module `billing/`) avec `createCustomer` / `createCheckoutSession` / `createPortalSession`, plus le nettoyage reprice hérité de B1 (`createPriceForProduct` + `updateProductName`, réutilisant le `stripe_product_id` stocké au lieu de créer un produit orphelin). Un router user `buildBillingUserRouter()` monté sous `/api/v1/billing` (via `userAuth()`) : les routes checkout/portal vérifient la membership du caller sur le network, garantissent un `stripe_customer_id` persisté sur `network_billing`, et renvoient l'URL hébergée. Les routes read renvoient soldes par bucket, catalogue actif, état d'abo, historique d'achats.

**Tech Stack:** Bun + Hono + Drizzle + `stripe` SDK. Tests `bun:test` via `bun run test` (JAMAIS `bun test` direct), gateway injectée en fake (`__setStripeGatewayForTests`).

## Global Constraints

- Spec : `docs/superpowers/specs/2026-07-03-billing-subscriptions-topups-design.md`. Facturation **per-network**.
- **Aucun appel Stripe réel dans les tests** : la `StripeGateway` est injectée en fake. Les routes ne renvoient jamais de secret ni d'id Stripe interne inutile.
- Le caller d'une route checkout/portal doit être **membre du network** ciblé (table `memberships`), sinon 403.
- `stripe_customer_id` est **persisté une fois** sur `network_billing` (réutilisé aux achats suivants) — un network = un customer Stripe.
- Le checkout porte des **metadata** `{ networkId, kind: "pack"|"subscription", packId?/planId?, userId }` — c'est ce que le webhook (B2b) lira pour fulfiller. La session référence le `stripe_price_id` du pack/formule.
- **Reprice cleanup (B1-carry)** : un changement de prix réutilise le product Stripe existant (`createPriceForProduct(productId,...)`) au lieu de créer un product orphelin ; un changement de nom appelle `updateProductName(productId, name)`.
- URLs de retour Checkout/Portal : `BILLING_SUCCESS_URL`, `BILLING_CANCEL_URL`, `BILLING_PORTAL_RETURN_URL` (env ; défaut = `EDITOR_URL` + `/credits`).
- Routes admin/user sous `/api/v1/`. Le router user est monté avec `app.use("/api/v1/billing/*", userAuth())` puis `app.route("/api/v1/billing", buildBillingUserRouter())`.
- Migration Drizzle générée + committée si le schéma change (ici : Task 4, index).
- `cd backend && bun run test`. Commits conventional. Stage explicite — jamais `git add -A` (WIP `backend/src/routes/link.ts`, `.agents/`, `AGENTS.md`).

---

### Task 1: Grossir `StripeGateway` (customer, checkout, portal)

**Files:**
- Modify: `backend/src/modules/billing/stripe.ts`
- Test: `backend/src/modules/billing/stripe.test.ts` (étendre)

**Interfaces:**
- Consumes: rien de nouveau.
- Produces: l'interface `StripeGateway` gagne :
  - `createCustomer(input: { metadata: Record<string, string>; email?: string }): Promise<{ customerId: string }>`
  - `createCheckoutSession(input: { mode: "payment" | "subscription"; priceId: string; customerId: string; successUrl: string; cancelUrl: string; metadata: Record<string, string> }): Promise<{ url: string }>`
  - `createPortalSession(input: { customerId: string; returnUrl: string }): Promise<{ url: string }>`

- [ ] **Step 1: Écrire le test**

Dans `backend/src/modules/billing/stripe.test.ts`, ajouter un `describe` (le fichier a déjà `__setStripeGatewayForTests`/`getStripeGateway`/`type StripeGateway`) :

```ts
describe("StripeGateway checkout/portal (fake records calls)", () => {
	it("a fake exposes customer/checkout/portal and records inputs", async () => {
		const calls: Record<string, unknown> = {};
		const fake: StripeGateway = {
			async createProductWithPrice() { return { productId: "prod", priceId: "price" }; },
			async archivePrice() {},
			async createCustomer(i) { calls.customer = i; return { customerId: "cus_1" }; },
			async createCheckoutSession(i) { calls.checkout = i; return { url: "https://checkout.test/s" }; },
			async createPortalSession(i) { calls.portal = i; return { url: "https://portal.test/s" }; },
		};
		__setStripeGatewayForTests(fake);
		const g = getStripeGateway();
		expect(await g.createCustomer({ metadata: { networkId: "n1" } })).toEqual({ customerId: "cus_1" });
		const co = await g.createCheckoutSession({ mode: "payment", priceId: "price", customerId: "cus_1", successUrl: "s", cancelUrl: "c", metadata: { kind: "pack" } });
		expect(co.url).toBe("https://checkout.test/s");
		const po = await g.createPortalSession({ customerId: "cus_1", returnUrl: "r" });
		expect(po.url).toBe("https://portal.test/s");
		expect((calls.checkout as { mode: string }).mode).toBe("payment");
	});
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `cd backend && bun run test src/modules/billing/stripe.test.ts`
Expected: FAIL — les nouvelles méthodes n'existent pas sur l'interface (TS) / le fake ne compile pas contre l'ancienne interface.

- [ ] **Step 3: Étendre l'interface + l'implémentation réelle**

Dans `stripe.ts`, ajouter à `interface StripeGateway` les 3 méthodes ci-dessus (bloc Interfaces). Dans `RealStripeGateway`, ajouter :

```ts
	async createCustomer(input: { metadata: Record<string, string>; email?: string }): Promise<{ customerId: string }> {
		const customer = await this.stripe.customers.create({
			metadata: input.metadata,
			...(input.email ? { email: input.email } : {}),
		});
		return { customerId: customer.id };
	}
	async createCheckoutSession(input: {
		mode: "payment" | "subscription";
		priceId: string;
		customerId: string;
		successUrl: string;
		cancelUrl: string;
		metadata: Record<string, string>;
	}): Promise<{ url: string }> {
		const session = await this.stripe.checkout.sessions.create({
			mode: input.mode,
			customer: input.customerId,
			line_items: [{ price: input.priceId, quantity: 1 }],
			success_url: input.successUrl,
			cancel_url: input.cancelUrl,
			metadata: input.metadata,
			...(input.mode === "subscription" ? { subscription_data: { metadata: input.metadata } } : {}),
		});
		if (!session.url) throw new Error("Stripe did not return a checkout url");
		return { url: session.url };
	}
	async createPortalSession(input: { customerId: string; returnUrl: string }): Promise<{ url: string }> {
		const session = await this.stripe.billingPortal.sessions.create({
			customer: input.customerId,
			return_url: input.returnUrl,
		});
		return { url: session.url };
	}
```

(Note `subscription_data.metadata` : Stripe copie ces metadata sur les invoices récurrentes → le webhook B2b les relira au renouvellement.)

- [ ] **Step 4: Run — expect PASS**

Run: `cd backend && bun run test src/modules/billing/stripe.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/billing/stripe.ts backend/src/modules/billing/stripe.test.ts
git commit -m "feat(backend): Stripe gateway customer/checkout/portal sessions"
```

---

### Task 2: Nettoyage reprice (product réutilisé + rename) — B1-carry

**Files:**
- Modify: `backend/src/modules/billing/stripe.ts`
- Modify: `backend/src/modules/billing/packsRepo.ts`, `plansRepo.ts`
- Test: `backend/src/modules/billing/packs.test.ts`, `plans.test.ts` (étendre)

**Interfaces:**
- Produces: `StripeGateway` gagne :
  - `createPriceForProduct(input: { productId: string; amountCents: number; currency: string; recurring?: { interval: "month" | "year" } }): Promise<{ priceId: string }>`
  - `updateProductName(productId: string, name: string): Promise<void>`
- `updatePack`/`updatePlan` : un changement de prix/devise (packs) ou prix/devise/intervalle (plans) réutilise le **product existant** (`createPriceForProduct(existing.stripeProductId, ...)`) + archive l'ancien price ; un changement de nom appelle `updateProductName(existing.stripeProductId, name)` (au lieu de laisser le nom Stripe périmé).

- [ ] **Step 1: Écrire les tests**

Dans `packs.test.ts` (le fake gateway y a déjà `archived`; ajouter des enregistrements) — remplacer le fake pour tracer product reuse + rename :

```ts
	it("PUT reuses the existing Stripe product on reprice (no orphan product) and archives the old price", async () => {
		const products: string[] = [];
		const priced: string[] = [];
		const renamed: Array<[string, string]> = [];
		const archived: string[] = [];
		__setStripeGatewayForTests({
			async createProductWithPrice() { const p = `prod_${products.length}`; products.push(p); return { productId: p, priceId: `price_${priced.push(p)}` }; },
			async createPriceForProduct(i) { priced.push(i.productId); return { priceId: `price_reuse_${priced.length}` }; },
			async updateProductName(id, name) { renamed.push([id, name]); },
			async archivePrice(id) { archived.push(id); },
			async createCustomer() { return { customerId: "c" }; },
			async createCheckoutSession() { return { url: "u" }; },
			async createPortalSession() { return { url: "u" }; },
		});
		const created = await (await app.request("/api/v1/admin/billing/packs", { method: "POST", headers: adminHeaders(), body: JSON.stringify({ name: "P", priceCents: 1000, credits: 500 }) })).json();
		const productCountAfterCreate = products.length;
		const put = await app.request(`/api/v1/admin/billing/packs/${created.id}`, { method: "PUT", headers: adminHeaders(), body: JSON.stringify({ priceCents: 2000 }) });
		const updated = await put.json();
		expect(products.length).toBe(productCountAfterCreate); // NO new product created on reprice
		expect(updated.stripePriceId).not.toBe(created.stripePriceId);
		expect(archived).toContain(created.stripePriceId);
	});

	it("PUT renaming updates the Stripe product name", async () => {
		const renamed: Array<[string, string]> = [];
		__setStripeGatewayForTests({
			async createProductWithPrice() { return { productId: "prod_x", priceId: "price_x" }; },
			async createPriceForProduct() { return { priceId: "price_y" }; },
			async updateProductName(id, name) { renamed.push([id, name]); },
			async archivePrice() {},
			async createCustomer() { return { customerId: "c" }; },
			async createCheckoutSession() { return { url: "u" }; },
			async createPortalSession() { return { url: "u" }; },
		});
		const created = await (await app.request("/api/v1/admin/billing/packs", { method: "POST", headers: adminHeaders(), body: JSON.stringify({ name: "Old", priceCents: 1000, credits: 500 }) })).json();
		await app.request(`/api/v1/admin/billing/packs/${created.id}`, { method: "PUT", headers: adminHeaders(), body: JSON.stringify({ name: "New" }) });
		expect(renamed).toContainEqual(["prod_x", "New"]);
	});
```

(Le `beforeAll` de `packs.test.ts` injecte un fake par défaut — mets à jour ce fake par défaut pour inclure les nouvelles méthodes, sinon les autres tests cassent à la compilation TS. Idem `plans.test.ts` : ajouter un test miroir « reprice reuses product » + « interval change reuses product ».)

- [ ] **Step 2: Run — expect FAIL**

Run: `cd backend && bun run test src/modules/billing/packs.test.ts`
Expected: FAIL — `createPriceForProduct`/`updateProductName` absents.

- [ ] **Step 3: Ajouter les méthodes à `stripe.ts`**

Interface : les 2 signatures ci-dessus. `RealStripeGateway` :

```ts
	async createPriceForProduct(input: {
		productId: string;
		amountCents: number;
		currency: string;
		recurring?: { interval: "month" | "year" };
	}): Promise<{ priceId: string }> {
		const price = await this.stripe.prices.create({
			product: input.productId,
			unit_amount: input.amountCents,
			currency: input.currency,
			...(input.recurring ? { recurring: { interval: input.recurring.interval } } : {}),
		});
		return { priceId: price.id };
	}
	async updateProductName(productId: string, name: string): Promise<void> {
		await this.stripe.products.update(productId, { name });
	}
```

- [ ] **Step 4: Refactorer `updatePack` (packsRepo.ts)**

Remplacer la logique de re-provisioning. READ la fonction courante ; changer le bloc reprice pour :

```ts
	// Name change → sync the Stripe product name.
	if (patch.name !== undefined && patch.name !== existing.name && existing.stripeProductId) {
		await getStripeGateway().updateProductName(existing.stripeProductId, patch.name);
	}
	const currencyChanged = patch.currency !== undefined && patch.currency !== existing.currency;
	const priceChanged = patch.priceCents !== undefined && patch.priceCents !== existing.priceCents;
	if ((priceChanged || currencyChanged) && existing.stripeProductId) {
		next.priceCents = patch.priceCents ?? existing.priceCents;
		const { priceId } = await getStripeGateway().createPriceForProduct({
			productId: existing.stripeProductId,
			amountCents: next.priceCents,
			currency: patch.currency ?? existing.currency,
		});
		next.stripePriceId = priceId;
		if (existing.stripePriceId) await getStripeGateway().archivePrice(existing.stripePriceId);
	}
```

- [ ] **Step 5: Refactorer `updatePlan` (plansRepo.ts)** — pareil, mais garder `intervalChanged` et passer `recurring: { interval: next.interval }` à `createPriceForProduct` :

```ts
	if (patch.name !== undefined && patch.name !== existing.name && existing.stripeProductId) {
		await getStripeGateway().updateProductName(existing.stripeProductId, patch.name);
	}
	const currencyChanged = patch.currency !== undefined && patch.currency !== existing.currency;
	const priceChanged = patch.priceCents !== undefined && patch.priceCents !== existing.priceCents;
	const intervalChanged = patch.interval !== undefined && patch.interval !== existing.interval;
	if ((priceChanged || currencyChanged || intervalChanged) && existing.stripeProductId) {
		next.interval = patch.interval ?? existing.interval;
		next.priceCents = patch.priceCents ?? existing.priceCents;
		const { priceId } = await getStripeGateway().createPriceForProduct({
			productId: existing.stripeProductId,
			amountCents: next.priceCents,
			currency: patch.currency ?? existing.currency,
			recurring: { interval: next.interval as "month" | "year" },
		});
		next.stripePriceId = priceId;
		if (existing.stripePriceId) await getStripeGateway().archivePrice(existing.stripePriceId);
	}
```

- [ ] **Step 6: Run — expect PASS + suite complète**

Run: `cd backend && bun run test src/modules/billing/packs.test.ts src/modules/billing/plans.test.ts src/modules/billing/stripe.test.ts`
Expected: PASS.
Run: `cd backend && bun run test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/billing/stripe.ts backend/src/modules/billing/packsRepo.ts backend/src/modules/billing/plansRepo.ts backend/src/modules/billing/packs.test.ts backend/src/modules/billing/plans.test.ts
git commit -m "fix(backend): reprice reuses Stripe product + syncs name (no orphan product)"
```

---

### Task 3: `network_billing` repo + routes checkout/portal (membership-gated)

**Files:**
- Create: `backend/src/modules/billing/networkBillingRepo.ts`
- Create: `backend/src/modules/billing/userRoutes.ts`
- Modify: `backend/src/app.ts` (monter `buildBillingUserRouter` sous `/api/v1/billing` avec `userAuth()`)
- Test: `backend/src/modules/billing/checkout.test.ts`

**Interfaces:**
- Consumes: `getStripeGateway` (Tasks 1-2), `getPack` (`packsRepo`), `getPlan` (`plansRepo`), table `networkBilling`, `memberships`, `users`, `getBucketBalances` (module ai, pour Task 4).
- Produces:
  - `getNetworkBilling(networkId): Promise<NetworkBillingRow | null>` ; `NetworkBillingRow` = ligne `networkBilling`.
  - `ensureCustomer(networkId: string, email?: string): Promise<string>` — renvoie le `stripe_customer_id`, le crée via la gateway + upsert `network_billing` s'il n'existe pas.
  - `buildBillingUserRouter(): Hono` avec `POST /billing/checkout/pack` (`{ networkId, packId }`), `POST /billing/checkout/subscription` (`{ networkId, planId }`), `POST /billing/portal` (`{ networkId }`). Chaque route : membership-check → 403 ; entité inconnue/inactive → 404 ; renvoie `{ url }`. Portal sans customer → 400 `no_billing`.
  - Helper interne `isMember(userId, networkId): Promise<boolean>`.

- [ ] **Step 1: Écrire les tests**

`backend/src/modules/billing/checkout.test.ts` (fixtures : network + user membre + user non-membre + un pack + une formule ; fake gateway) :

```ts
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { app } from "../../app";
import { db } from "../../db/index";
import { creditPacks, memberships, networkBilling, networks, subscriptionPlans, users } from "../../db/schema";
import { createNetwork } from "../../lib/networkManager";
import { createSession } from "../../lib/sessionManager";
import { __setStripeGatewayForTests, type StripeGateway } from "./stripe";

const USER_ID = "usr_billing_co";
const OUTSIDER_ID = "usr_billing_out";
let networkId = "";
let userSession = "";
let outsiderSession = "";
let packId = "";
let planId = "";

function fake(): StripeGateway {
	return {
		async createProductWithPrice() { return { productId: "prod", priceId: "price" }; },
		async createPriceForProduct() { return { priceId: "price2" }; },
		async updateProductName() {},
		async archivePrice() {},
		async createCustomer() { return { customerId: "cus_test" }; },
		async createCheckoutSession(i) { return { url: `https://checkout.test/${i.mode}/${i.metadata.kind}` }; },
		async createPortalSession() { return { url: "https://portal.test/s" }; },
	};
}

const cookie = (s: string) => ({ Cookie: `artisan_user_session=${s}`, "Content-Type": "application/json" });

beforeAll(async () => {
	networkId = (await createNetwork("billing-co-net")).id;
	const now = new Date();
	for (const [id, email] of [[USER_ID, "co@example.com"], [OUTSIDER_ID, "out@example.com"]] as const) {
		await db.insert(users).values({ id, email, name: id, createdAt: now, updatedAt: now }).onConflictDoNothing();
	}
	await db.insert(memberships).values({ id: "mem_billing_co", userId: USER_ID, networkId, role: "owner", createdAt: now }).onConflictDoNothing();
	userSession = (await createSession(USER_ID)).id;
	outsiderSession = (await createSession(OUTSIDER_ID)).id;
	packId = crypto.randomUUID();
	planId = crypto.randomUUID();
	await db.insert(creditPacks).values({ id: packId, name: "P", priceCents: 1000, currency: "eur", credits: 500, bonusPct: 0, isActive: true, sortOrder: 0, stripeProductId: "prod_p", stripePriceId: "price_p", createdAt: now, updatedAt: now });
	await db.insert(subscriptionPlans).values({ id: planId, name: "Pro", interval: "month", priceCents: 2000, currency: "eur", creditsPerPeriod: 5000, rolloverCap: 0, features: "", isActive: true, sortOrder: 0, stripeProductId: "prod_s", stripePriceId: "price_s", createdAt: now, updatedAt: now });
	__setStripeGatewayForTests(fake());
});

afterAll(async () => {
	__setStripeGatewayForTests(null);
	await db.delete(networkBilling).where(eq(networkBilling.networkId, networkId));
	await db.delete(networks).where(eq(networks.id, networkId)); // cascades memberships
	await db.delete(users).where(eq(users.id, USER_ID));
	await db.delete(users).where(eq(users.id, OUTSIDER_ID));
	await db.delete(creditPacks).where(eq(creditPacks.id, packId));
	await db.delete(subscriptionPlans).where(eq(subscriptionPlans.id, planId));
});

describe("billing checkout/portal routes", () => {
	it("401 without a session", async () => {
		expect((await app.request("/api/v1/billing/checkout/pack", { method: "POST", body: "{}" })).status).toBe(401);
	});

	it("pack checkout returns a hosted url and persists the customer", async () => {
		const res = await app.request("/api/v1/billing/checkout/pack", { method: "POST", headers: cookie(userSession), body: JSON.stringify({ networkId, packId }) });
		expect(res.status).toBe(200);
		expect((await res.json()).url).toContain("checkout.test/payment/pack");
		const [row] = await db.select().from(networkBilling).where(eq(networkBilling.networkId, networkId));
		expect(row.stripeCustomerId).toBe("cus_test");
	});

	it("subscription checkout uses mode=subscription", async () => {
		const res = await app.request("/api/v1/billing/checkout/subscription", { method: "POST", headers: cookie(userSession), body: JSON.stringify({ networkId, planId }) });
		expect(res.status).toBe(200);
		expect((await res.json()).url).toContain("checkout.test/subscription/subscription");
	});

	it("non-member → 403", async () => {
		const res = await app.request("/api/v1/billing/checkout/pack", { method: "POST", headers: cookie(outsiderSession), body: JSON.stringify({ networkId, packId }) });
		expect(res.status).toBe(403);
	});

	it("unknown/inactive pack → 404", async () => {
		const res = await app.request("/api/v1/billing/checkout/pack", { method: "POST", headers: cookie(userSession), body: JSON.stringify({ networkId, packId: "nope" }) });
		expect(res.status).toBe(404);
	});

	it("portal returns a url once a customer exists", async () => {
		// the pack checkout above persisted the customer
		const res = await app.request("/api/v1/billing/portal", { method: "POST", headers: cookie(userSession), body: JSON.stringify({ networkId }) });
		expect(res.status).toBe(200);
		expect((await res.json()).url).toContain("portal.test");
	});
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `cd backend && bun run test src/modules/billing/checkout.test.ts`
Expected: FAIL — routes 404 (router pas monté).

- [ ] **Step 3: Implémenter `networkBillingRepo.ts`**

```ts
import { and, eq } from "drizzle-orm";
import { db } from "../../db/index";
import { memberships, networkBilling } from "../../db/schema";
import { getStripeGateway } from "./stripe";

export type NetworkBillingRow = typeof networkBilling.$inferSelect;

export async function getNetworkBilling(networkId: string): Promise<NetworkBillingRow | null> {
	const rows = await db.select().from(networkBilling).where(eq(networkBilling.networkId, networkId));
	return rows[0] ?? null;
}

export async function isMember(userId: string, networkId: string): Promise<boolean> {
	const rows = await db
		.select({ id: memberships.id })
		.from(memberships)
		.where(and(eq(memberships.userId, userId), eq(memberships.networkId, networkId)));
	return rows.length > 0;
}

/** Return the network's Stripe customer id, creating+persisting it if absent. */
export async function ensureCustomer(networkId: string, email?: string): Promise<string> {
	const existing = await getNetworkBilling(networkId);
	if (existing?.stripeCustomerId) return existing.stripeCustomerId;
	const { customerId } = await getStripeGateway().createCustomer({ metadata: { networkId }, email });
	const now = new Date();
	if (existing) {
		await db
			.update(networkBilling)
			.set({ stripeCustomerId: customerId, updatedAt: now })
			.where(eq(networkBilling.networkId, networkId));
	} else {
		await db.insert(networkBilling).values({ networkId, stripeCustomerId: customerId, createdAt: now, updatedAt: now });
	}
	return customerId;
}
```

- [ ] **Step 4: Implémenter `userRoutes.ts` (checkout + portal)**

```ts
import { Hono } from "hono";
import { getPack } from "./packsRepo";
import { getPlan } from "./plansRepo";
import { ensureCustomer, getNetworkBilling, isMember } from "./networkBillingRepo";
import { getStripeGateway } from "./stripe";

const editorUrl = (): string => process.env.EDITOR_URL ?? "http://localhost:5173";
const successUrl = (): string => process.env.BILLING_SUCCESS_URL ?? `${editorUrl()}/credits?checkout=success`;
const cancelUrl = (): string => process.env.BILLING_CANCEL_URL ?? `${editorUrl()}/credits?checkout=cancel`;
const portalReturnUrl = (): string => process.env.BILLING_PORTAL_RETURN_URL ?? `${editorUrl()}/credits`;

export function buildBillingUserRouter(): Hono {
	const r = new Hono();

	r.post("/billing/checkout/pack", async (c) => {
		const user = c.get("user");
		const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
		const networkId = typeof body.networkId === "string" ? body.networkId : "";
		const packId = typeof body.packId === "string" ? body.packId : "";
		if (!(await isMember(user.id, networkId))) return c.json({ error: "forbidden" }, 403);
		const pack = await getPack(packId);
		if (!pack || !pack.isActive || !pack.stripePriceId) return c.json({ error: "pack_not_found" }, 404);
		const customerId = await ensureCustomer(networkId, user.email);
		const { url } = await getStripeGateway().createCheckoutSession({
			mode: "payment",
			priceId: pack.stripePriceId,
			customerId,
			successUrl: successUrl(),
			cancelUrl: cancelUrl(),
			metadata: { networkId, kind: "pack", packId, userId: user.id },
		});
		return c.json({ url });
	});

	r.post("/billing/checkout/subscription", async (c) => {
		const user = c.get("user");
		const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
		const networkId = typeof body.networkId === "string" ? body.networkId : "";
		const planId = typeof body.planId === "string" ? body.planId : "";
		if (!(await isMember(user.id, networkId))) return c.json({ error: "forbidden" }, 403);
		const plan = await getPlan(planId);
		if (!plan || !plan.isActive || !plan.stripePriceId) return c.json({ error: "plan_not_found" }, 404);
		const customerId = await ensureCustomer(networkId, user.email);
		const { url } = await getStripeGateway().createCheckoutSession({
			mode: "subscription",
			priceId: plan.stripePriceId,
			customerId,
			successUrl: successUrl(),
			cancelUrl: cancelUrl(),
			metadata: { networkId, kind: "subscription", planId, userId: user.id },
		});
		return c.json({ url });
	});

	r.post("/billing/portal", async (c) => {
		const user = c.get("user");
		const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
		const networkId = typeof body.networkId === "string" ? body.networkId : "";
		if (!(await isMember(user.id, networkId))) return c.json({ error: "forbidden" }, 403);
		const billing = await getNetworkBilling(networkId);
		if (!billing?.stripeCustomerId) return c.json({ error: "no_billing" }, 400);
		const { url } = await getStripeGateway().createPortalSession({
			customerId: billing.stripeCustomerId,
			returnUrl: portalReturnUrl(),
		});
		return c.json({ url });
	});

	return r;
}
```

Note : `c.get("user")` porte `{ id, email, ... }` (posé par `userAuth()` — cf. `middleware/userAuth.ts`).

- [ ] **Step 5: Monter dans `app.ts`**

```ts
import { buildBillingUserRouter } from "./modules/billing/userRoutes";
```
et après les autres routes user (vers la ligne 58) :

```ts
app.use("/api/v1/billing/*", userAuth());
app.route("/api/v1/billing", buildBillingUserRouter());
```

- [ ] **Step 6: Run — expect PASS**

Run: `cd backend && bun run test src/modules/billing/checkout.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/billing/networkBillingRepo.ts backend/src/modules/billing/userRoutes.ts backend/src/app.ts backend/src/modules/billing/checkout.test.ts
git commit -m "feat(backend): billing checkout (pack/subscription) + portal routes"
```

---

### Task 4: Routes read user (balance, catalogue, abo, historique) + index purchases

**Files:**
- Modify: `backend/src/modules/billing/userRoutes.ts` (ajouter 5 GET)
- Modify: `backend/src/db/schema.ts` (index unique partiel sur `creditPurchases.stripeSessionId`) + migration
- Create: `backend/src/modules/billing/purchasesRepo.ts`
- Test: `backend/src/modules/billing/read.test.ts`

**Interfaces:**
- Consumes: `getBucketBalances` (`../ai/creditsRepo`), `listPacks`/`listPlans`, `getNetworkBilling`, `isMember`, table `creditPurchases`, `getPlan`.
- Produces:
  - `listPurchases(networkId, limit?): Promise<Purchase[]>` (`purchasesRepo`).
  - `GET /billing/balance?networkId=` → `{ subscription, rollover, topup, total, subscriptionQuota, periodEnd }` (bucket balances + le quota du plan actif + la date de renouvellement).
  - `GET /billing/packs` → `{ packs }` (actifs, DTO public sans ids Stripe internes : `{ id, name, priceCents, currency, credits, bonusPct, creditsGranted }`).
  - `GET /billing/plans` → `{ plans }` (actifs : `{ id, name, interval, priceCents, currency, creditsPerPeriod, rolloverCap, features }`).
  - `GET /billing/subscription?networkId=` → `{ status, planId, planName, currentPeriodEnd, graceUntil }` | `{ status: null }`.
  - `GET /billing/purchases?networkId=` → `{ purchases: { id, amountCents, currency, credits, stripeInvoiceUrl, createdAt }[] }`.
  - Toutes membership-gated (403 non-membre) sauf `packs`/`plans` (catalogue public au user authentifié).
  - Index unique partiel `credit_purchases_session_uniq` sur `stripeSessionId WHERE stripe_session_id IS NOT NULL` (2e ceinture d'idempotence pour B2b).

- [ ] **Step 1: Écrire les tests**

`backend/src/modules/billing/read.test.ts` (réutiliser les fixtures façon checkout.test.ts : network + membre + un pack actif + une formule ; seeder quelques `credit_purchases` + un `network_billing` avec status/plan ; seeder des entrées `ai_credit_ledger` par bucket) :

```ts
	it("GET /billing/balance returns per-bucket balances (member only)", async () => {
		// seed: 100 subscription (future exp), 50 topup
		await grantCredits({ networkId, amount: 100, bucket: "subscription", expiresAt: new Date("2999-01-01"), periodId: "p1" });
		await grantCredits({ networkId, amount: 50, bucket: "topup" });
		const res = await app.request(`/api/v1/billing/balance?networkId=${networkId}`, { headers: cookie(userSession) });
		expect(res.status).toBe(200);
		const b = await res.json();
		expect(b.total).toBe(150);
		expect(b.subscription).toBe(100);
		const out = await app.request(`/api/v1/billing/balance?networkId=${networkId}`, { headers: cookie(outsiderSession) });
		expect(out.status).toBe(403);
	});

	it("GET /billing/packs lists active packs with creditsGranted (bonus applied), no Stripe ids", async () => {
		const res = await app.request("/api/v1/billing/packs", { headers: cookie(userSession) });
		const { packs } = await res.json();
		expect(packs.length).toBeGreaterThan(0);
		expect(JSON.stringify(packs)).not.toContain("stripe");
		// pack seeded with credits 500 bonus 20 → creditsGranted 600
		expect(packs.find((p: { creditsGranted: number }) => p.creditsGranted === 600)).toBeTruthy();
	});

	it("GET /billing/subscription reflects network_billing", async () => {
		const res = await app.request(`/api/v1/billing/subscription?networkId=${networkId}`, { headers: cookie(userSession) });
		const s = await res.json();
		expect(s.status).toBe("active");
		expect(s.planId).toBe(planId);
	});

	it("GET /billing/purchases lists the network's purchases newest first", async () => {
		const res = await app.request(`/api/v1/billing/purchases?networkId=${networkId}`, { headers: cookie(userSession) });
		const { purchases } = await res.json();
		expect(purchases.length).toBeGreaterThan(0);
		expect(typeof purchases[0].createdAt).toBe("string");
	});
```

(Adapter le `beforeAll` : pack seedé avec `bonusPct: 20`, `credits: 500` ; `network_billing` seedé `status: "active"`, `planId`, `currentPeriodEnd` ; un `credit_purchases`. Importer `grantCredits` de `../ai/creditsRepo`.)

- [ ] **Step 2: Run — expect FAIL**

Run: `cd backend && bun run test src/modules/billing/read.test.ts`
Expected: FAIL — routes 404.

- [ ] **Step 3: Index migration**

Dans `schema.ts`, `creditPurchases` : ajouter au 2e argument du `pgTable` :

```ts
		uniqueIndex("credit_purchases_session_uniq")
			.on(t.stripeSessionId)
			.where(sql`stripe_session_id is not null`),
```
(importer `uniqueIndex`/`sql` s'ils ne le sont pas déjà — ils le sont). Puis `cd backend && bun run db:generate`.

- [ ] **Step 4: `purchasesRepo.ts`**

```ts
import { desc, eq } from "drizzle-orm";
import { db } from "../../db/index";
import { creditPurchases } from "../../db/schema";

export type Purchase = typeof creditPurchases.$inferSelect;

export async function listPurchases(networkId: string, limit = 50): Promise<Purchase[]> {
	return db
		.select()
		.from(creditPurchases)
		.where(eq(creditPurchases.networkId, networkId))
		.orderBy(desc(creditPurchases.createdAt), desc(creditPurchases.id))
		.limit(limit);
}
```

- [ ] **Step 5: Ajouter les 5 GET dans `userRoutes.ts`**

Imports : `import { getBucketBalances } from "../ai/creditsRepo";`, `import { listPacks, creditsForPack } from "./packsRepo";`, `import { listPlans, getPlan } from "./plansRepo";`, `import { listPurchases } from "./purchasesRepo";` (+ `getNetworkBilling`/`isMember` déjà importés).

```ts
	r.get("/billing/balance", async (c) => {
		const user = c.get("user");
		const networkId = c.req.query("networkId") ?? "";
		if (!(await isMember(user.id, networkId))) return c.json({ error: "forbidden" }, 403);
		const b = await getBucketBalances(networkId);
		const billing = await getNetworkBilling(networkId);
		let subscriptionQuota = 0;
		if (billing?.planId) {
			const plan = await getPlan(billing.planId);
			subscriptionQuota = plan?.creditsPerPeriod ?? 0;
		}
		return c.json({ ...b, subscriptionQuota, periodEnd: billing?.currentPeriodEnd?.toISOString() ?? null });
	});

	r.get("/billing/packs", async (c) => {
		const packs = (await listPacks())
			.filter((p) => p.isActive)
			.map((p) => ({
				id: p.id, name: p.name, priceCents: p.priceCents, currency: p.currency,
				credits: p.credits, bonusPct: p.bonusPct, creditsGranted: creditsForPack(p),
			}));
		return c.json({ packs });
	});

	r.get("/billing/plans", async (c) => {
		const plans = (await listPlans())
			.filter((p) => p.isActive)
			.map((p) => ({
				id: p.id, name: p.name, interval: p.interval, priceCents: p.priceCents,
				currency: p.currency, creditsPerPeriod: p.creditsPerPeriod, rolloverCap: p.rolloverCap, features: p.features,
			}));
		return c.json({ plans });
	});

	r.get("/billing/subscription", async (c) => {
		const user = c.get("user");
		const networkId = c.req.query("networkId") ?? "";
		if (!(await isMember(user.id, networkId))) return c.json({ error: "forbidden" }, 403);
		const billing = await getNetworkBilling(networkId);
		if (!billing?.status) return c.json({ status: null });
		const plan = billing.planId ? await getPlan(billing.planId) : null;
		return c.json({
			status: billing.status,
			planId: billing.planId,
			planName: plan?.name ?? null,
			currentPeriodEnd: billing.currentPeriodEnd?.toISOString() ?? null,
			graceUntil: billing.graceUntil?.toISOString() ?? null,
		});
	});

	r.get("/billing/purchases", async (c) => {
		const user = c.get("user");
		const networkId = c.req.query("networkId") ?? "";
		if (!(await isMember(user.id, networkId))) return c.json({ error: "forbidden" }, 403);
		const purchases = (await listPurchases(networkId)).map((p) => ({
			id: p.id, amountCents: p.amountCents, currency: p.currency, credits: p.credits,
			stripeInvoiceUrl: p.stripeInvoiceUrl, createdAt: p.createdAt.toISOString(),
		}));
		return c.json({ purchases });
	});
```

- [ ] **Step 6: Run — expect PASS + suite complète**

Run: `cd backend && bun run test src/modules/billing/read.test.ts`
Expected: PASS.
Run: `cd backend && bun run test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/billing/purchasesRepo.ts backend/src/modules/billing/userRoutes.ts backend/src/db/schema.ts backend/drizzle/ backend/src/modules/billing/read.test.ts
git commit -m "feat(backend): billing read routes (balance, catalog, subscription, purchases) + session index"
```

---

### Task 5: Docs

**Files:**
- Modify: `docs/architecture/rest-endpoints.md`, `CHANGELOG.md`, `.env.example`

- [ ] **Step 1: rest-endpoints.md** — ajouter :

```markdown
| `/api/v1/billing/checkout/{pack,subscription}`, `/api/v1/billing/portal`, `/api/v1/billing/{balance,packs,plans,subscription,purchases}` | User billing : sessions Checkout hébergées (top-up / abo), Customer Portal, soldes par bucket + catalogue + état d'abo + historique (membership-gated) | `backend/src/modules/billing/userRoutes.ts` |
```

- [ ] **Step 2: CHANGELOG** — `[Unreleased] ### Added` :

```markdown
- Billing checkout/portal (Stripe hosted): `POST /api/v1/billing/checkout/{pack,subscription}` + `/billing/portal` (membership-gated, persists the network's Stripe customer), read routes `GET /billing/{balance,packs,plans,subscription,purchases}` for the credit indicator + `/credits` page. Reprice now reuses the Stripe product (no orphan). Fulfillment via webhook pending (B2b).
```

- [ ] **Step 3: .env.example** — sous le bloc Stripe :

```
BILLING_SUCCESS_URL=
BILLING_CANCEL_URL=
BILLING_PORTAL_RETURN_URL=
```
(commentaire : retours des pages hébergées Stripe ; défaut = EDITOR_URL + /credits.)

- [ ] **Step 4: Suite complète finale**

Run: `cd backend && bun run test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add docs/architecture/rest-endpoints.md CHANGELOG.md .env.example
git commit -m "docs: billing checkout/portal/read routes + return-url env"
```
