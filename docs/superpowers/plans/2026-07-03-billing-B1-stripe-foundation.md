# Billing — Plan B1 : Fondation Stripe (schéma + gateway + CRUD admin packs/formules)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Les tables billing (packs, formules, abonnement network, achats, events Stripe), une passerelle Stripe mockable, et le CRUD admin des packs + formules qui provisionne les products/prices Stripe — sans encore de Checkout ni webhooks (= B2).

**Architecture:** Nouveau domaine `backend/src/modules/billing/`. Une `StripeGateway` (interface + implémentation SDK `stripe` + fake injectable via `__setStripeGatewayForTests`, façon `__setProviderForTests` du module assistant) isole tout appel Stripe → les tests n'ont jamais besoin de clé réelle. Le CRUD admin des packs/formules crée/archive les products+prices Stripe via la gateway et stocke les ids. Routes admin montées sous `/api/v1/admin` derrière `userAuth()` + `requireAdmin()` (pattern `buildAiAdminRouter`).

**Tech Stack:** Bun + Hono + Drizzle (PostgreSQL) + `stripe` (npm SDK, nouvelle dépendance). Tests `bun:test` via `bun run test` (JAMAIS `bun test` direct).

## Global Constraints

- Spec : `docs/superpowers/specs/2026-07-03-billing-subscriptions-topups-design.md`.
- Facturation **per-network**. Prix en **cents** (int), `currency` `"eur"`. Credits en int. **Credits accordés d'un pack = `credits + round(credits*bonus_pct/100)`** (bonus additif). V1 : abo `interval` = `month` (le champ porte `year` pour V1.5).
- **Aucun appel Stripe réel dans les tests** : la `StripeGateway` est injectée en fake via `__setStripeGatewayForTests`. La clé `STRIPE_SECRET_KEY` (env) n'est lue que par l'implémentation réelle.
- Prix Stripe **immuables** : un changement de montant/credits/intervalle crée un nouveau price + archive l'ancien (jamais de mutation de price).
- Routes admin sous `/api/v1/admin/*`, gated par `userAuth()` + `requireAdmin()` déjà appliqués dans `app.ts` (lignes ~57-58) ; le router billing se monte avec `app.route("/api/v1/admin", buildBillingAdminRouter())`.
- Clés API (secret Stripe) : lues via `process.env`, jamais renvoyées par une route ni loggées.
- Migration Drizzle générée (`bun run db:generate`) et **committée** avec le changement de `schema.ts`.
- Lancer la suite : `cd backend && bun run test` (Docker PostgreSQL up).
- Commits conventional. Stage explicite — jamais `git add -A` (WIP `backend/src/routes/link.ts`, `.agents/`, `AGENTS.md` non liés dans l'arbre).

---

### Task 1: Schéma billing (5 tables) + migration

**Files:**
- Modify: `backend/src/db/schema.ts` (append 5 tables)
- Create: `backend/drizzle/00NN_*.sql` (généré)
- Modify: `docs/architecture/entities.md`

**Interfaces:**
- Produces: tables Drizzle `creditPacks`, `subscriptionPlans`, `networkBilling`, `creditPurchases`, `stripeEvents` — importées par les tasks suivantes depuis `../../db/schema`.

- [ ] **Step 1: Ajouter les tables**

Dans `backend/src/db/schema.ts`, append en fin de fichier :

```ts
// Admin-defined top-up packs (one-off credit purchases). Provisioned as a
// Stripe product+price (stripe_price_id). Credits granted at purchase =
// credits + round(credits*bonus_pct/100). Cf. spec 2026-07-03 §1.1.
export const creditPacks = pgTable("credit_packs", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	priceCents: integer("price_cents").notNull(),
	currency: text("currency").notNull().default("eur"),
	credits: integer("credits").notNull(),
	bonusPct: integer("bonus_pct").notNull().default(0),
	isActive: boolean("is_active").notNull().default(true),
	sortOrder: integer("sort_order").notNull().default(0),
	stripeProductId: text("stripe_product_id"),
	stripePriceId: text("stripe_price_id"),
	createdAt: timestamp("created_at").notNull(),
	updatedAt: timestamp("updated_at").notNull(),
});

// Admin-defined recurring subscription plans. interval="month" in V1
// (year reserved). credits_per_period granted each renewal; rollover_cap caps
// carried-over credits. Cf. spec §2.1/§2.2.
export const subscriptionPlans = pgTable("subscription_plans", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	interval: text("interval").notNull().default("month"), // "month" | "year"
	priceCents: integer("price_cents").notNull(),
	currency: text("currency").notNull().default("eur"),
	creditsPerPeriod: integer("credits_per_period").notNull(),
	rolloverCap: integer("rollover_cap").notNull().default(0),
	features: text("features").notNull().default(""),
	isActive: boolean("is_active").notNull().default(true),
	sortOrder: integer("sort_order").notNull().default(0),
	stripeProductId: text("stripe_product_id"),
	stripePriceId: text("stripe_price_id"),
	createdAt: timestamp("created_at").notNull(),
	updatedAt: timestamp("updated_at").notNull(),
});

// One row per network with billing state. status null = no subscription.
// networks.tier stays a denormalized quick flag updated by the webhook (B2).
export const networkBilling = pgTable("network_billing", {
	networkId: text("network_id")
		.primaryKey()
		.references(() => networks.id, { onDelete: "cascade" }),
	stripeCustomerId: text("stripe_customer_id"),
	stripeSubscriptionId: text("stripe_subscription_id"),
	planId: text("plan_id").references(() => subscriptionPlans.id),
	status: text("status"), // "active" | "past_due" | "grace" | "canceled" | null
	currentPeriodEnd: timestamp("current_period_end"),
	graceUntil: timestamp("grace_until"),
	createdAt: timestamp("created_at").notNull(),
	updatedAt: timestamp("updated_at").notNull(),
});

// Audit of top-up purchases (history §1.3). Invoices live in Stripe; we store
// the hosted invoice URL. credits = credits actually granted (incl. bonus).
export const creditPurchases = pgTable(
	"credit_purchases",
	{
		id: text("id").primaryKey(),
		networkId: text("network_id")
			.notNull()
			.references(() => networks.id, { onDelete: "cascade" }),
		packId: text("pack_id").references(() => creditPacks.id),
		stripeSessionId: text("stripe_session_id"),
		stripeInvoiceUrl: text("stripe_invoice_url"),
		amountCents: integer("amount_cents").notNull(),
		currency: text("currency").notNull().default("eur"),
		credits: integer("credits").notNull(),
		createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
		createdAt: timestamp("created_at").notNull(),
	},
	(t) => [index("credit_purchases_network_time_idx").on(t.networkId, t.createdAt)],
);

// Webhook idempotency: one row per processed Stripe event id (B2 uses it).
export const stripeEvents = pgTable("stripe_events", {
	eventId: text("event_id").primaryKey(),
	type: text("type").notNull(),
	processedAt: timestamp("processed_at").notNull(),
});
```

- [ ] **Step 2: Générer la migration**

Run: `cd backend && bun run db:generate`
Expected: `backend/drizzle/00NN_*.sql` avec `CREATE TABLE "credit_packs"`, `"subscription_plans"`, `"network_billing"`, `"credit_purchases"`, `"stripe_events"`.

- [ ] **Step 3: Suite verte (migration appliquée sur artisan_test)**

Run: `cd backend && bun run test`
Expected: PASS (additif).

- [ ] **Step 4: entities.md**

Dans `docs/architecture/entities.md`, nouvelle section :

```markdown
## Billing (2026-07-03)

- **`credit_packs`** / **`subscription_plans`** — catalogue admin des top-ups et formules, provisionnés en products/prices Stripe (`stripe_product_id`/`stripe_price_id`). Prix en cents. Pack : credits accordés = `credits + round(credits*bonus_pct/100)`.
- **`network_billing`** — état de facturation par network (`stripe_customer_id`, `stripe_subscription_id`, `plan_id`, `status`, `current_period_end`, `grace_until`). `networks.tier` = flag dénormalisé.
- **`credit_purchases`** — audit des top-ups (historique §1.3) ; l'URL de facture pointe Stripe.
- **`stripe_events`** — idempotence des webhooks (B2).
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/db/schema.ts backend/drizzle/ docs/architecture/entities.md
git commit -m "feat(backend): billing schema (packs, plans, network_billing, purchases, stripe_events)"
```

---

### Task 2: Passerelle Stripe mockable (`stripe.ts`)

**Files:**
- Modify: `backend/package.json` (dépendance `stripe`)
- Create: `backend/src/modules/billing/stripe.ts`
- Test: `backend/src/modules/billing/stripe.test.ts`

**Interfaces:**
- Produces:
  - `interface StripeGateway { createProductWithPrice(input): Promise<{ productId: string; priceId: string }>; archivePrice(priceId: string): Promise<void> }` où `input = { name: string; amountCents: number; currency: string; recurring?: { interval: "month" | "year" } }`.
  - `getStripeGateway(): StripeGateway` — renvoie le fake injecté sinon l'implémentation réelle (SDK).
  - `__setStripeGatewayForTests(g: StripeGateway | null): void`.

- [ ] **Step 1: Ajouter la dépendance**

Run: `cd backend && bun add stripe`
Expected: `stripe` ajouté à `backend/package.json` dependencies.

- [ ] **Step 2: Écrire le test**

`backend/src/modules/billing/stripe.test.ts` :

```ts
import { afterEach, describe, expect, it } from "bun:test";
import { __setStripeGatewayForTests, getStripeGateway, type StripeGateway } from "./stripe";

afterEach(() => __setStripeGatewayForTests(null));

describe("StripeGateway injection", () => {
	it("getStripeGateway returns the injected fake", () => {
		const fake: StripeGateway = {
			async createProductWithPrice() { return { productId: "prod_x", priceId: "price_x" }; },
			async archivePrice() {},
		};
		__setStripeGatewayForTests(fake);
		expect(getStripeGateway()).toBe(fake);
	});

	it("a fake records calls and returns ids", async () => {
		const calls: unknown[] = [];
		const fake: StripeGateway = {
			async createProductWithPrice(input) { calls.push(input); return { productId: "p1", priceId: "pr1" }; },
			async archivePrice(id) { calls.push({ archive: id }); },
		};
		__setStripeGatewayForTests(fake);
		const g = getStripeGateway();
		const r = await g.createProductWithPrice({ name: "Pack 10", amountCents: 1000, currency: "eur" });
		expect(r).toEqual({ productId: "p1", priceId: "pr1" });
		await g.archivePrice("pr1");
		expect(calls).toEqual([
			{ name: "Pack 10", amountCents: 1000, currency: "eur" },
			{ archive: "pr1" },
		]);
	});
});
```

- [ ] **Step 3: Run — expect FAIL**

Run: `cd backend && bun run test src/modules/billing/stripe.test.ts`
Expected: FAIL — module `./stripe` introuvable.

- [ ] **Step 4: Implémenter `stripe.ts`**

```ts
import Stripe from "stripe";

export interface StripeGateway {
	/** Create a Stripe product + a price for it. `recurring` → a subscription
	 *  price; omitted → a one-off price. Returns the created ids. */
	createProductWithPrice(input: {
		name: string;
		amountCents: number;
		currency: string;
		recurring?: { interval: "month" | "year" };
	}): Promise<{ productId: string; priceId: string }>;
	/** Archive a price (Stripe prices are immutable; deactivating/repricing
	 *  archives the old one). */
	archivePrice(priceId: string): Promise<void>;
}

class RealStripeGateway implements StripeGateway {
	private stripe: Stripe;
	constructor(secretKey: string) {
		this.stripe = new Stripe(secretKey);
	}
	async createProductWithPrice(input: {
		name: string;
		amountCents: number;
		currency: string;
		recurring?: { interval: "month" | "year" };
	}): Promise<{ productId: string; priceId: string }> {
		const product = await this.stripe.products.create({ name: input.name });
		const price = await this.stripe.prices.create({
			product: product.id,
			unit_amount: input.amountCents,
			currency: input.currency,
			...(input.recurring ? { recurring: { interval: input.recurring.interval } } : {}),
		});
		return { productId: product.id, priceId: price.id };
	}
	async archivePrice(priceId: string): Promise<void> {
		await this.stripe.prices.update(priceId, { active: false });
	}
}

let injected: StripeGateway | null = null;
let real: StripeGateway | null = null;

/** Test hook: inject a fake gateway (skips the real SDK). */
export function __setStripeGatewayForTests(g: StripeGateway | null): void {
	injected = g;
}

/** The active gateway: injected fake in tests, else the real SDK gateway.
 *  Throws if STRIPE_SECRET_KEY is missing and no fake is injected. */
export function getStripeGateway(): StripeGateway {
	if (injected) return injected;
	if (!real) {
		const key = process.env.STRIPE_SECRET_KEY;
		if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
		real = new RealStripeGateway(key);
	}
	return real;
}
```

- [ ] **Step 5: Run — expect PASS**

Run: `cd backend && bun run test src/modules/billing/stripe.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/package.json backend/bun.lock backend/src/modules/billing/stripe.ts backend/src/modules/billing/stripe.test.ts
git commit -m "feat(backend): mockable Stripe gateway (product/price provisioning)"
```

(Note : le lockfile s'appelle `bun.lock` ou `bun.lockb` selon la version — stage celui qui a changé.)

---

### Task 3: Packs — repo + routes admin CRUD (provisioning Stripe)

**Files:**
- Create: `backend/src/modules/billing/packsRepo.ts`
- Create: `backend/src/modules/billing/adminRoutes.ts`
- Modify: `backend/src/app.ts` (monter `buildBillingAdminRouter`)
- Test: `backend/src/modules/billing/packs.test.ts`

**Interfaces:**
- Consumes: table `creditPacks` (Task 1), `getStripeGateway` (Task 2).
- Produces:
  - `interface CreditPack { id; name; priceCents; currency; credits; bonusPct; isActive; sortOrder; stripeProductId: string|null; stripePriceId: string|null; createdAt: Date; updatedAt: Date }`.
  - `type PackInput = { name; priceCents; currency?; credits; bonusPct?; isActive?; sortOrder? }`.
  - `listPacks()`, `getPack(id)`, `createPack(input)` (provisionne le product/price Stripe), `updatePack(id, patch)` (re-provisionne un nouveau price + archive l'ancien si prix/intervalle change — ici pas d'intervalle), `deactivatePack(id)`.
  - `creditsForPack(p: CreditPack): number` = `p.credits + Math.round(p.credits * p.bonusPct / 100)` (exporté, réutilisé par B2 au moment du grant).
  - Router `buildBillingAdminRouter()` avec `GET/POST /billing/packs`, `PUT /billing/packs/:id`, `POST /billing/packs/:id/deactivate`. DTO `PackDto` = `CreditPack` avec dates ISO.

- [ ] **Step 1: Écrire les tests**

`backend/src/modules/billing/packs.test.ts` (fixtures admin façon `ai/adminRoutes.grant.test.ts` — admin user + session cookie ; fake gateway) :

```ts
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { app } from "../../app";
import { db } from "../../db/index";
import { creditPacks, users } from "../../db/schema";
import { createSession } from "../../lib/sessionManager";
import { creditsForPack } from "./packsRepo";
import { __setStripeGatewayForTests, type StripeGateway } from "./stripe";

const ADMIN_ID = "user_admin_packs";
let adminSession = "";

function fakeGateway(): StripeGateway {
	let n = 0;
	return {
		async createProductWithPrice() { n++; return { productId: `prod_${n}`, priceId: `price_${n}` }; },
		async archivePrice() {},
	};
}

beforeAll(async () => {
	const now = new Date();
	await db.insert(users).values({ id: ADMIN_ID, email: `${ADMIN_ID}@example.com`, name: "Admin", isAdmin: true, createdAt: now, updatedAt: now }).onConflictDoNothing();
	adminSession = (await createSession(ADMIN_ID)).id;
	__setStripeGatewayForTests(fakeGateway());
});

afterEach(async () => { await db.delete(creditPacks); });

afterAll(async () => {
	__setStripeGatewayForTests(null);
	await db.delete(users).where(eq(users.id, ADMIN_ID));
});

const adminHeaders = () => ({ Cookie: `artisan_user_session=${adminSession}`, "Content-Type": "application/json" });

describe("creditsForPack", () => {
	it("adds the bonus percentage (rounded)", () => {
		expect(creditsForPack({ credits: 1000, bonusPct: 25 } as never)).toBe(1250);
		expect(creditsForPack({ credits: 1000, bonusPct: 0 } as never)).toBe(1000);
		expect(creditsForPack({ credits: 333, bonusPct: 10 } as never)).toBe(366); // 333 + round(33.3)=33 → 366
	});
});

describe("admin packs routes", () => {
	it("403 without admin", async () => {
		expect((await app.request("/api/v1/admin/billing/packs")).status).toBe(403);
	});

	it("POST creates a pack + provisions a Stripe price; GET lists it", async () => {
		const post = await app.request("/api/v1/admin/billing/packs", {
			method: "POST", headers: adminHeaders(),
			body: JSON.stringify({ name: "Pack 10€", priceCents: 1000, credits: 1000, bonusPct: 25 }),
		});
		expect(post.status).toBe(200);
		const created = await post.json();
		expect(created.stripePriceId).toBe("price_1");
		expect(created.credits).toBe(1000);
		const list = await (await app.request("/api/v1/admin/billing/packs", { headers: adminHeaders() })).json();
		expect(list.packs.length).toBe(1);
		expect(typeof list.packs[0].createdAt).toBe("string");
	});

	it("POST validates (missing name / non-positive price → 400)", async () => {
		const bad = await app.request("/api/v1/admin/billing/packs", {
			method: "POST", headers: adminHeaders(),
			body: JSON.stringify({ name: "", priceCents: 1000, credits: 100 }),
		});
		expect(bad.status).toBe(400);
		const badPrice = await app.request("/api/v1/admin/billing/packs", {
			method: "POST", headers: adminHeaders(),
			body: JSON.stringify({ name: "X", priceCents: 0, credits: 100 }),
		});
		expect(badPrice.status).toBe(400);
	});

	it("PUT re-provisions a new price when the amount changes", async () => {
		const created = await (await app.request("/api/v1/admin/billing/packs", {
			method: "POST", headers: adminHeaders(),
			body: JSON.stringify({ name: "P", priceCents: 1000, credits: 500 }),
		})).json();
		const put = await app.request(`/api/v1/admin/billing/packs/${created.id}`, {
			method: "PUT", headers: adminHeaders(),
			body: JSON.stringify({ priceCents: 2000 }),
		});
		expect(put.status).toBe(200);
		const updated = await put.json();
		expect(updated.priceCents).toBe(2000);
		expect(updated.stripePriceId).not.toBe(created.stripePriceId); // new price provisioned
	});

	it("deactivate flips is_active", async () => {
		const created = await (await app.request("/api/v1/admin/billing/packs", {
			method: "POST", headers: adminHeaders(),
			body: JSON.stringify({ name: "P", priceCents: 1000, credits: 500 }),
		})).json();
		const res = await app.request(`/api/v1/admin/billing/packs/${created.id}/deactivate`, { method: "POST", headers: adminHeaders() });
		expect(res.status).toBe(200);
		const [row] = await db.select().from(creditPacks).where(eq(creditPacks.id, created.id));
		expect(row.isActive).toBe(false);
	});
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `cd backend && bun run test src/modules/billing/packs.test.ts`
Expected: FAIL — modules / routes absents (404 sur `/api/v1/admin/billing/packs`).

- [ ] **Step 3: Implémenter `packsRepo.ts`**

```ts
import { eq } from "drizzle-orm";
import { db } from "../../db/index";
import { creditPacks } from "../../db/schema";
import { getStripeGateway } from "./stripe";

export interface CreditPack {
	id: string;
	name: string;
	priceCents: number;
	currency: string;
	credits: number;
	bonusPct: number;
	isActive: boolean;
	sortOrder: number;
	stripeProductId: string | null;
	stripePriceId: string | null;
	createdAt: Date;
	updatedAt: Date;
}
export type PackInput = {
	name: string;
	priceCents: number;
	currency?: string;
	credits: number;
	bonusPct?: number;
	isActive?: boolean;
	sortOrder?: number;
};

/** Credits actually granted for a pack purchase: base + additive bonus. */
export function creditsForPack(p: Pick<CreditPack, "credits" | "bonusPct">): number {
	return p.credits + Math.round((p.credits * p.bonusPct) / 100);
}

export async function listPacks(): Promise<CreditPack[]> {
	return db.select().from(creditPacks).orderBy(creditPacks.sortOrder);
}
export async function getPack(id: string): Promise<CreditPack | null> {
	const rows = await db.select().from(creditPacks).where(eq(creditPacks.id, id));
	return rows[0] ?? null;
}

export async function createPack(input: PackInput): Promise<CreditPack> {
	const currency = input.currency ?? "eur";
	const { productId, priceId } = await getStripeGateway().createProductWithPrice({
		name: input.name,
		amountCents: input.priceCents,
		currency,
	});
	const now = new Date();
	const row = {
		id: crypto.randomUUID(),
		name: input.name,
		priceCents: input.priceCents,
		currency,
		credits: input.credits,
		bonusPct: input.bonusPct ?? 0,
		isActive: input.isActive ?? true,
		sortOrder: input.sortOrder ?? 0,
		stripeProductId: productId,
		stripePriceId: priceId,
		createdAt: now,
		updatedAt: now,
	};
	await db.insert(creditPacks).values(row);
	return row;
}

export async function updatePack(id: string, patch: Partial<PackInput>): Promise<CreditPack | null> {
	const existing = await getPack(id);
	if (!existing) return null;
	const next: Partial<CreditPack> = { updatedAt: new Date() };
	if (patch.name !== undefined) next.name = patch.name;
	if (patch.credits !== undefined) next.credits = patch.credits;
	if (patch.bonusPct !== undefined) next.bonusPct = patch.bonusPct;
	if (patch.isActive !== undefined) next.isActive = patch.isActive;
	if (patch.sortOrder !== undefined) next.sortOrder = patch.sortOrder;
	if (patch.currency !== undefined) next.currency = patch.currency;
	// Amount change → provision a NEW Stripe price and archive the old one.
	if (patch.priceCents !== undefined && patch.priceCents !== existing.priceCents) {
		next.priceCents = patch.priceCents;
		const { productId, priceId } = await getStripeGateway().createProductWithPrice({
			name: patch.name ?? existing.name,
			amountCents: patch.priceCents,
			currency: patch.currency ?? existing.currency,
		});
		next.stripeProductId = productId;
		next.stripePriceId = priceId;
		if (existing.stripePriceId) await getStripeGateway().archivePrice(existing.stripePriceId);
	}
	const rows = await db.update(creditPacks).set(next).where(eq(creditPacks.id, id)).returning();
	return rows[0] ?? null;
}

export async function deactivatePack(id: string): Promise<boolean> {
	const rows = await db
		.update(creditPacks)
		.set({ isActive: false, updatedAt: new Date() })
		.where(eq(creditPacks.id, id))
		.returning();
	return rows.length > 0;
}
```

- [ ] **Step 4: Implémenter `adminRoutes.ts` (partie packs)**

```ts
import { Hono } from "hono";
import {
	createPack,
	deactivatePack,
	getPack,
	listPacks,
	updatePack,
	type CreditPack,
	type PackInput,
} from "./packsRepo";

function packDto(p: CreditPack) {
	return { ...p, createdAt: p.createdAt.toISOString(), updatedAt: p.updatedAt.toISOString() };
}

/** null si invalide. `partial` autorise les champs manquants (PUT). */
function parsePackBody(body: Record<string, unknown>, partial: boolean): Partial<PackInput> | null {
	const out: Partial<PackInput> = {};
	if (typeof body.name === "string") out.name = body.name;
	if (typeof body.currency === "string") out.currency = body.currency;
	const int = (k: string) => (typeof body[k] === "number" && Number.isInteger(body[k]) ? (body[k] as number) : undefined);
	const priceCents = int("priceCents");
	if (priceCents !== undefined) out.priceCents = priceCents;
	const credits = int("credits");
	if (credits !== undefined) out.credits = credits;
	const bonusPct = int("bonusPct");
	if (bonusPct !== undefined) out.bonusPct = bonusPct;
	const sortOrder = int("sortOrder");
	if (sortOrder !== undefined) out.sortOrder = sortOrder;
	if (typeof body.isActive === "boolean") out.isActive = body.isActive;
	// Validation
	if (out.name === "") return null;
	if (out.priceCents !== undefined && out.priceCents <= 0) return null;
	if (out.credits !== undefined && out.credits <= 0) return null;
	if (out.bonusPct !== undefined && out.bonusPct < 0) return null;
	if (!partial) {
		if (!out.name || out.priceCents === undefined || out.credits === undefined) return null;
	}
	return out;
}

export function buildBillingAdminRouter(): Hono {
	const r = new Hono();

	r.get("/billing/packs", async (c) => c.json({ packs: (await listPacks()).map(packDto) }));

	r.post("/billing/packs", async (c) => {
		const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
		const input = parsePackBody(body, false);
		if (!input) return c.json({ error: "invalid_pack" }, 400);
		const pack = await createPack(input as PackInput);
		return c.json(packDto(pack));
	});

	r.put("/billing/packs/:id", async (c) => {
		const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
		const patch = parsePackBody(body, true);
		if (!patch) return c.json({ error: "invalid_pack" }, 400);
		if (!(await getPack(c.req.param("id")))) return c.json({ error: "not_found" }, 404);
		const pack = await updatePack(c.req.param("id"), patch);
		return pack ? c.json(packDto(pack)) : c.json({ error: "not_found" }, 404);
	});

	r.post("/billing/packs/:id/deactivate", async (c) => {
		const ok = await deactivatePack(c.req.param("id"));
		return ok ? c.json({ ok: true }) : c.json({ error: "not_found" }, 404);
	});

	return r;
}
```

- [ ] **Step 5: Monter dans `app.ts`**

Dans `backend/src/app.ts` : `import { buildBillingAdminRouter } from "./modules/billing/adminRoutes";` et, après les autres `app.route("/api/v1/admin", ...)` (vers la ligne 60) :

```ts
app.route("/api/v1/admin", buildBillingAdminRouter());
```

- [ ] **Step 6: Run — expect PASS**

Run: `cd backend && bun run test src/modules/billing/packs.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/billing/packsRepo.ts backend/src/modules/billing/adminRoutes.ts backend/src/app.ts backend/src/modules/billing/packs.test.ts
git commit -m "feat(backend): admin credit-pack CRUD + Stripe price provisioning"
```

---

### Task 4: Formules — repo + routes admin CRUD (provisioning Stripe récurrent)

**Files:**
- Create: `backend/src/modules/billing/plansRepo.ts`
- Modify: `backend/src/modules/billing/adminRoutes.ts` (ajouter les routes plans)
- Test: `backend/src/modules/billing/plans.test.ts`

**Interfaces:**
- Consumes: table `subscriptionPlans`, `getStripeGateway`.
- Produces:
  - `interface SubscriptionPlan { id; name; interval; priceCents; currency; creditsPerPeriod; rolloverCap; features; isActive; sortOrder; stripeProductId: string|null; stripePriceId: string|null; createdAt: Date; updatedAt: Date }`.
  - `type PlanInput = { name; interval?; priceCents; currency?; creditsPerPeriod; rolloverCap?; features?; isActive?; sortOrder? }`.
  - `listPlans()`, `getPlan(id)`, `createPlan(input)` (provisionne un price récurrent), `updatePlan(id, patch)` (re-provisionne si prix/intervalle change), `deactivatePlan(id)`.
  - Routes `GET/POST /billing/plans`, `PUT /billing/plans/:id`, `POST /billing/plans/:id/deactivate` ajoutées au `buildBillingAdminRouter`.

- [ ] **Step 1: Écrire les tests**

`backend/src/modules/billing/plans.test.ts` — mêmes fixtures que packs (admin `user_admin_plans`, fake gateway) :

```ts
	it("POST creates a plan + provisions a RECURRING Stripe price", async () => {
		let recurringSeen: unknown = null;
		__setStripeGatewayForTests({
			async createProductWithPrice(input) { recurringSeen = input.recurring; return { productId: "prod_s", priceId: "price_s" }; },
			async archivePrice() {},
		});
		const post = await app.request("/api/v1/admin/billing/plans", {
			method: "POST", headers: adminHeaders(),
			body: JSON.stringify({ name: "Pro", priceCents: 2000, creditsPerPeriod: 5000, rolloverCap: 1000 }),
		});
		expect(post.status).toBe(200);
		const created = await post.json();
		expect(created.interval).toBe("month");
		expect(created.stripePriceId).toBe("price_s");
		expect(recurringSeen).toEqual({ interval: "month" });
	});

	it("POST validates (missing name / non-positive price / negative rolloverCap → 400)", async () => {
		for (const body of [
			{ name: "", priceCents: 2000, creditsPerPeriod: 100 },
			{ name: "X", priceCents: 0, creditsPerPeriod: 100 },
			{ name: "X", priceCents: 2000, creditsPerPeriod: 100, rolloverCap: -5 },
		]) {
			const res = await app.request("/api/v1/admin/billing/plans", { method: "POST", headers: adminHeaders(), body: JSON.stringify(body) });
			expect(res.status).toBe(400);
		}
	});
```

(Reprendre la structure beforeAll/afterEach/afterAll de `packs.test.ts` — admin id `user_admin_plans`, cleanup `subscriptionPlans`, fake gateway par défaut renvoyant `prod_N`/`price_N`.)

- [ ] **Step 2: Run — expect FAIL**

Run: `cd backend && bun run test src/modules/billing/plans.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implémenter `plansRepo.ts`** (calqué sur `packsRepo.ts`, avec `recurring: { interval }` au provisioning)

```ts
import { eq } from "drizzle-orm";
import { db } from "../../db/index";
import { subscriptionPlans } from "../../db/schema";
import { getStripeGateway } from "./stripe";

export interface SubscriptionPlan {
	id: string;
	name: string;
	interval: string;
	priceCents: number;
	currency: string;
	creditsPerPeriod: number;
	rolloverCap: number;
	features: string;
	isActive: boolean;
	sortOrder: number;
	stripeProductId: string | null;
	stripePriceId: string | null;
	createdAt: Date;
	updatedAt: Date;
}
export type PlanInput = {
	name: string;
	interval?: "month" | "year";
	priceCents: number;
	currency?: string;
	creditsPerPeriod: number;
	rolloverCap?: number;
	features?: string;
	isActive?: boolean;
	sortOrder?: number;
};

export async function listPlans(): Promise<SubscriptionPlan[]> {
	return db.select().from(subscriptionPlans).orderBy(subscriptionPlans.sortOrder);
}
export async function getPlan(id: string): Promise<SubscriptionPlan | null> {
	const rows = await db.select().from(subscriptionPlans).where(eq(subscriptionPlans.id, id));
	return rows[0] ?? null;
}

export async function createPlan(input: PlanInput): Promise<SubscriptionPlan> {
	const currency = input.currency ?? "eur";
	const interval = input.interval ?? "month";
	const { productId, priceId } = await getStripeGateway().createProductWithPrice({
		name: input.name,
		amountCents: input.priceCents,
		currency,
		recurring: { interval },
	});
	const now = new Date();
	const row = {
		id: crypto.randomUUID(),
		name: input.name,
		interval,
		priceCents: input.priceCents,
		currency,
		creditsPerPeriod: input.creditsPerPeriod,
		rolloverCap: input.rolloverCap ?? 0,
		features: input.features ?? "",
		isActive: input.isActive ?? true,
		sortOrder: input.sortOrder ?? 0,
		stripeProductId: productId,
		stripePriceId: priceId,
		createdAt: now,
		updatedAt: now,
	};
	await db.insert(subscriptionPlans).values(row);
	return row;
}

export async function updatePlan(id: string, patch: Partial<PlanInput>): Promise<SubscriptionPlan | null> {
	const existing = await getPlan(id);
	if (!existing) return null;
	const next: Partial<SubscriptionPlan> = { updatedAt: new Date() };
	if (patch.name !== undefined) next.name = patch.name;
	if (patch.creditsPerPeriod !== undefined) next.creditsPerPeriod = patch.creditsPerPeriod;
	if (patch.rolloverCap !== undefined) next.rolloverCap = patch.rolloverCap;
	if (patch.features !== undefined) next.features = patch.features;
	if (patch.isActive !== undefined) next.isActive = patch.isActive;
	if (patch.sortOrder !== undefined) next.sortOrder = patch.sortOrder;
	if (patch.currency !== undefined) next.currency = patch.currency;
	const intervalChanged = patch.interval !== undefined && patch.interval !== existing.interval;
	const priceChanged = patch.priceCents !== undefined && patch.priceCents !== existing.priceCents;
	if (intervalChanged || priceChanged) {
		next.interval = patch.interval ?? existing.interval;
		next.priceCents = patch.priceCents ?? existing.priceCents;
		const { productId, priceId } = await getStripeGateway().createProductWithPrice({
			name: patch.name ?? existing.name,
			amountCents: next.priceCents,
			currency: patch.currency ?? existing.currency,
			recurring: { interval: next.interval as "month" | "year" },
		});
		next.stripeProductId = productId;
		next.stripePriceId = priceId;
		if (existing.stripePriceId) await getStripeGateway().archivePrice(existing.stripePriceId);
	}
	const rows = await db.update(subscriptionPlans).set(next).where(eq(subscriptionPlans.id, id)).returning();
	return rows[0] ?? null;
}

export async function deactivatePlan(id: string): Promise<boolean> {
	const rows = await db
		.update(subscriptionPlans)
		.set({ isActive: false, updatedAt: new Date() })
		.where(eq(subscriptionPlans.id, id))
		.returning();
	return rows.length > 0;
}
```

- [ ] **Step 4: Ajouter les routes plans dans `adminRoutes.ts`**

Imports : `import { createPlan, deactivatePlan, getPlan, listPlans, updatePlan, type PlanInput, type SubscriptionPlan } from "./plansRepo";`

Helpers + routes (avant le `return r;`) :

```ts
function planDto(p: SubscriptionPlan) {
	return { ...p, createdAt: p.createdAt.toISOString(), updatedAt: p.updatedAt.toISOString() };
}

function parsePlanBody(body: Record<string, unknown>, partial: boolean): Partial<PlanInput> | null {
	const out: Partial<PlanInput> = {};
	if (typeof body.name === "string") out.name = body.name;
	if (typeof body.currency === "string") out.currency = body.currency;
	if (typeof body.features === "string") out.features = body.features;
	if (body.interval === "month" || body.interval === "year") out.interval = body.interval;
	const int = (k: string) => (typeof body[k] === "number" && Number.isInteger(body[k]) ? (body[k] as number) : undefined);
	const priceCents = int("priceCents");
	if (priceCents !== undefined) out.priceCents = priceCents;
	const cpp = int("creditsPerPeriod");
	if (cpp !== undefined) out.creditsPerPeriod = cpp;
	const cap = int("rolloverCap");
	if (cap !== undefined) out.rolloverCap = cap;
	const sortOrder = int("sortOrder");
	if (sortOrder !== undefined) out.sortOrder = sortOrder;
	if (typeof body.isActive === "boolean") out.isActive = body.isActive;
	if (out.name === "") return null;
	if (out.priceCents !== undefined && out.priceCents <= 0) return null;
	if (out.creditsPerPeriod !== undefined && out.creditsPerPeriod <= 0) return null;
	if (out.rolloverCap !== undefined && out.rolloverCap < 0) return null;
	if (!partial) {
		if (!out.name || out.priceCents === undefined || out.creditsPerPeriod === undefined) return null;
	}
	return out;
}

	r.get("/billing/plans", async (c) => c.json({ plans: (await listPlans()).map(planDto) }));
	r.post("/billing/plans", async (c) => {
		const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
		const input = parsePlanBody(body, false);
		if (!input) return c.json({ error: "invalid_plan" }, 400);
		return c.json(planDto(await createPlan(input as PlanInput)));
	});
	r.put("/billing/plans/:id", async (c) => {
		const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
		const patch = parsePlanBody(body, true);
		if (!patch) return c.json({ error: "invalid_plan" }, 400);
		if (!(await getPlan(c.req.param("id")))) return c.json({ error: "not_found" }, 404);
		const plan = await updatePlan(c.req.param("id"), patch);
		return plan ? c.json(planDto(plan)) : c.json({ error: "not_found" }, 404);
	});
	r.post("/billing/plans/:id/deactivate", async (c) => {
		const ok = await deactivatePlan(c.req.param("id"));
		return ok ? c.json({ ok: true }) : c.json({ error: "not_found" }, 404);
	});
```

- [ ] **Step 5: Run — expect PASS + suite complète**

Run: `cd backend && bun run test src/modules/billing/plans.test.ts src/modules/billing/packs.test.ts`
Expected: PASS.
Run: `cd backend && bun run test`
Expected: PASS — suite complète.

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/billing/plansRepo.ts backend/src/modules/billing/adminRoutes.ts backend/src/modules/billing/plans.test.ts
git commit -m "feat(backend): admin subscription-plan CRUD + recurring Stripe price"
```

---

### Task 5: Docs + env

**Files:**
- Modify: `docs/architecture/rest-endpoints.md`, `CHANGELOG.md`, `.env.example`, `CLAUDE.md`

- [ ] **Step 1: rest-endpoints.md**

```markdown
| `/api/v1/admin/billing/packs*`, `/api/v1/admin/billing/plans*` | CRUD admin des packs de credits + formules d'abonnement (provisionne les products/prices Stripe) | `backend/src/modules/billing/adminRoutes.ts` |
```

- [ ] **Step 2: CHANGELOG** — sous `[Unreleased] ### Added` :

```markdown
- Billing foundation (Stripe): tables `credit_packs`/`subscription_plans`/`network_billing`/`credit_purchases`/`stripe_events`; mockable `StripeGateway`; admin CRUD `GET/POST/PUT /api/v1/admin/billing/{packs,plans}` + `/:id/deactivate` provisioning Stripe products/prices. Checkout/webhooks pending (sub-project B2).
```

- [ ] **Step 3: .env.example** — ajouter :

```
# Stripe billing (sub-project B). STRIPE_SECRET_KEY is read only by the real
# gateway; tests inject a fake. STRIPE_WEBHOOK_SECRET is used by B2's webhook.
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
```

- [ ] **Step 4: CLAUDE.md** — dans le tableau des variables d'environnement backend, ajouter `STRIPE_SECRET_KEY` (clé secrète Stripe, lue par la gateway réelle ; vide en test) et `STRIPE_WEBHOOK_SECRET` (vérification signature webhook, B2).

- [ ] **Step 5: Commit**

```bash
git add docs/architecture/rest-endpoints.md CHANGELOG.md .env.example CLAUDE.md
git commit -m "docs: billing foundation (rest-endpoints, CHANGELOG, Stripe env)"
```
