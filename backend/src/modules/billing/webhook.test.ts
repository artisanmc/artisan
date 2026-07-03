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
