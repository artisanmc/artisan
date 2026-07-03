import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { app } from "../../app";
import { db } from "../../db/index";
import { aiCreditLedger, creditPacks, creditPurchases, networkBilling, networks, stripeEvents, subscriptionPlans, users } from "../../db/schema";
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
	// FK: network_billing.plan_id → subscription_plans.id — seed the plan referenced by the subscription-checkout fixture.
	await db.insert(subscriptionPlans).values({ id: "plan_x", name: "Plan X", priceCents: 2000, currency: "eur", creditsPerPeriod: 1000, createdAt: now, updatedAt: now }).onConflictDoNothing();
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
	await db.delete(subscriptionPlans).where(eq(subscriptionPlans.id, "plan_x"));
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

describe("webhook invoice.paid", () => {
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
		await db.delete(networkBilling).where(eq(networkBilling.networkId, networkId));
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
		await db.delete(networkBilling).where(eq(networkBilling.networkId, networkId));
		await db.delete(subscriptionPlans).where(eq(subscriptionPlans.id, planId));
	});
});
