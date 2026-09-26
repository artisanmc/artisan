import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { app } from "../../app";
import { db } from "../../db/index";
import { aiCreditLedger, creditPacks, creditPurchases, networkBilling, networks, stripeEvents, subscriptionPlans, users } from "../../db/schema";
import { createNetwork } from "../../lib/networkManager";
import { getBucketBalances } from "../ai/creditsRepo";
import { grantDueAnnualProCredits } from "./annualProCredits";
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

	it("a redelivered checkout with a NEW event id but the SAME session is an idempotent no-op (no 500 retry-storm)", async () => {
		const object = { id: "cs_dup", customer: "cus_1", amount_total: 1000, currency: "eur", metadata: { networkId, kind: "pack", packId, userId: USER_ID } };
		const first = await post({ id: "evt_dup_1", type: "checkout.session.completed", data: { object } });
		expect(first.status).toBe(200);
		expect((await getBucketBalances(networkId)).topup).toBe(600);
		// Same session id, DIFFERENT event id: the stripe_events claim does NOT block
		// this, but the credit_purchases unique index does — must settle to 200 with no
		// double grant, not a 500 that makes Stripe retry forever.
		const second = await post({ id: "evt_dup_2", type: "checkout.session.completed", data: { object } });
		expect(second.status).toBe(200);
		expect((await getBucketBalances(networkId)).topup).toBe(600); // not 1200
		const purchases = await db.select().from(creditPurchases).where(eq(creditPurchases.networkId, networkId));
		expect(purchases.length).toBe(1);
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

	it("subscription checkout upserts — updates an existing network_billing row (atomic, no SELECT-then-write)", async () => {
		const planId = crypto.randomUUID();
		await db.insert(subscriptionPlans).values({ id: planId, name: "Pro", interval: "month", priceCents: 2000, currency: "eur", creditsPerPeriod: 5000, rolloverCap: 1000, features: "", isActive: true, sortOrder: 0, stripeProductId: "prod_u", stripePriceId: "price_u", createdAt: new Date(), updatedAt: new Date() });
		await db.insert(networkBilling).values({ networkId, stripeCustomerId: "old_cus", stripeSubscriptionId: "old_sub", status: "active", createdAt: new Date(), updatedAt: new Date() });
		try {
			const res = await post({
				id: "evt_sub_up", type: "checkout.session.completed",
				data: { object: { id: "cs_up", customer: "cus_new", subscription: "sub_new",
					metadata: { networkId, kind: "subscription", planId, userId: USER_ID } } },
			});
			expect(res.status).toBe(200);
			const rows = await db.select().from(networkBilling).where(eq(networkBilling.networkId, networkId));
			expect(rows.length).toBe(1); // updated in place, not duplicated
			expect(rows[0].stripeCustomerId).toBe("cus_new");
			expect(rows[0].stripeSubscriptionId).toBe("sub_new");
			expect(rows[0].planId).toBe(planId);
		} finally {
			await db.delete(networkBilling).where(eq(networkBilling.networkId, networkId));
			await db.delete(subscriptionPlans).where(eq(subscriptionPlans.id, planId));
		}
	});

	it("unknown event type → 200 received, no-op", async () => {
		const res = await post({ id: "evt_x", type: "customer.created", data: { object: {} } });
		expect(res.status).toBe(200);
	});
});

describe("webhook invoice.paid", () => {
	it("starts monthly grants when a paid same-end change activates annual Pro", async () => {
		const planId = crypto.randomUUID();
		const start = new Date("2999-01-31T00:00:00Z");
		const end = new Date("3000-01-31T00:00:00Z");
		await db.insert(subscriptionPlans).values({ id: planId, name: "Artisan Pro", interval: "year", priceCents: 7000, currency: "eur", creditsPerPeriod: 500, rolloverCap: 0, editorPro: true, stripeProductId: `prod_${planId}`, stripePriceId: `price_${planId}`, createdAt: new Date(), updatedAt: new Date() });
		await db.insert(networkBilling).values({ networkId, stripeSubscriptionId: "sub_same_end", planId, currentPeriodId: "previous", paidThrough: end, paidEditorPro: false, createdAt: new Date(), updatedAt: new Date() });
		try {
			const invoice = { id: "inv_same_end", subscription: "sub_same_end", billing_reason: "subscription_cycle", lines: { data: [{ period: { start: Math.floor(start.getTime() / 1000), end: Math.floor(end.getTime() / 1000) } }] } };
			expect((await post({ id: "evt_same_end", type: "invoice.paid", data: { object: invoice } })).status).toBe(200);
			const [row] = await db.select().from(networkBilling).where(eq(networkBilling.networkId, networkId));
			expect(row.creditCycleStart?.getTime()).toBe(start.getTime());
			expect(row.creditMonthIndex).toBe(0);
			expect((await getBucketBalances(networkId)).subscription).toBe(500);
			await grantDueAnnualProCredits(new Date("2999-02-28T00:00:00Z"));
			expect((await getBucketBalances(networkId)).subscription).toBe(500);
		} finally {
			await db.delete(networkBilling).where(eq(networkBilling.networkId, networkId));
			await db.delete(subscriptionPlans).where(eq(subscriptionPlans.id, planId));
		}
	});
	it("grants annual Pro credits monthly, idempotently, instead of all at once", async () => {
		const planId = crypto.randomUUID();
		const start = new Date("2999-01-31T00:00:00Z");
		const end = new Date("3000-01-31T00:00:00Z");
		await db.insert(subscriptionPlans).values({ id: planId, name: "Artisan Pro", interval: "year", priceCents: 7000, currency: "eur", creditsPerPeriod: 500, rolloverCap: 0, editorPro: true, stripeProductId: `prod_${planId}`, stripePriceId: `price_${planId}`, createdAt: new Date(), updatedAt: new Date() });
		await db.insert(networkBilling).values({ networkId, stripeSubscriptionId: "sub_annual", planId, createdAt: new Date(), updatedAt: new Date() });
		try {
			const invoice = { id: "inv_annual", subscription: "sub_annual", billing_reason: "subscription_create", lines: { data: [{ period: { start: Math.floor(start.getTime() / 1000), end: Math.floor(end.getTime() / 1000) } }] } };
			expect((await post({ id: "evt_annual", type: "invoice.paid", data: { object: invoice } })).status).toBe(200);
			expect((await getBucketBalances(networkId)).subscription).toBe(500);
			const [first] = await db.select().from(networkBilling).where(eq(networkBilling.networkId, networkId));
			expect(first.creditCycleStart?.getTime()).toBe(start.getTime());
			expect(first.creditMonthIndex).toBe(0);
			const [firstGrant] = await db.select().from(aiCreditLedger).where(eq(aiCreditLedger.periodId, first.currentPeriodId!));
			expect(firstGrant.expiresAt?.toISOString()).toBe("2999-02-28T00:00:00.000Z");
			await grantDueAnnualProCredits(new Date("2999-02-28T00:00:01Z"));
			await grantDueAnnualProCredits(new Date("2999-02-28T00:00:01Z"));
			expect((await getBucketBalances(networkId)).subscription).toBe(500);
			const [second] = await db.select().from(networkBilling).where(eq(networkBilling.networkId, networkId));
			expect(second.creditMonthIndex).toBe(1);
			expect(second.currentPeriodId).not.toBe(first.currentPeriodId);
			await grantDueAnnualProCredits(new Date("2999-04-01T00:00:00Z"));
			const [catchup] = await db.select().from(networkBilling).where(eq(networkBilling.networkId, networkId));
			expect(catchup.creditMonthIndex).toBe(2);
			expect((await getBucketBalances(networkId)).subscription).toBe(500);
			const renewalStart = end;
			const renewalEnd = new Date("3001-01-31T00:00:00Z");
			expect((await post({ id: "evt_annual_renew", type: "invoice.paid", data: { object: { id: "inv_annual_renew", subscription: "sub_annual", billing_reason: "subscription_cycle", lines: { data: [{ period: { start: Math.floor(renewalStart.getTime() / 1000), end: Math.floor(renewalEnd.getTime() / 1000) } }] } } } })).status).toBe(200);
			const [renewed] = await db.select().from(networkBilling).where(eq(networkBilling.networkId, networkId));
			expect(renewed.creditCycleStart?.getTime()).toBe(renewalStart.getTime());
			expect(renewed.creditMonthIndex).toBe(0);
			expect((await getBucketBalances(networkId)).subscription).toBe(500);
		} finally {
			await db.delete(networkBilling).where(eq(networkBilling.networkId, networkId));
			await db.delete(subscriptionPlans).where(eq(subscriptionPlans.id, planId));
		}
	});
	it("ignores a late older invoice without moving paid access backward", async () => {
		const planId = crypto.randomUUID();
		await db.insert(subscriptionPlans).values({ id: planId, name: "Pro", interval: "month", priceCents: 2000, currency: "eur", creditsPerPeriod: 5000, rolloverCap: 0, features: "", isActive: true, sortOrder: 0, stripeProductId: "prod_s", stripePriceId: "price_s", createdAt: new Date(), updatedAt: new Date() });
		const latestEnd = new Date("2999-03-01T00:00:00Z");
		await db.insert(networkBilling).values({ networkId, stripeSubscriptionId: "sub_late", planId, currentPeriodId: "inv_latest", currentPeriodEnd: latestEnd, paidThrough: latestEnd, status: "active", createdAt: new Date(), updatedAt: new Date() });
		const olderEnd = Math.floor(new Date("2999-02-01T00:00:00Z").getTime() / 1000);
		const res = await post({ id: "evt_late", type: "invoice.paid", data: { object: { id: "inv_older", subscription: "sub_late", billing_reason: "subscription_cycle", lines: { data: [{ period: { end: olderEnd } }] } } } });
		expect(res.status).toBe(200);
		const [row] = await db.select().from(networkBilling).where(eq(networkBilling.networkId, networkId));
		expect(row.currentPeriodId).toBe("inv_latest");
		expect(row.currentPeriodEnd?.getTime()).toBe(latestEnd.getTime());
		await db.delete(networkBilling).where(eq(networkBilling.networkId, networkId));
		await db.delete(subscriptionPlans).where(eq(subscriptionPlans.id, planId));
	});
	it("invoice.paid (subscription_create) activates the subscription + grants the first period", async () => {
		const planId = crypto.randomUUID();
		await db.insert(subscriptionPlans).values({ id: planId, name: "Pro", interval: "month", priceCents: 2000, currency: "eur", creditsPerPeriod: 5000, rolloverCap: 1000, editorPro: true, features: "", isActive: true, sortOrder: 0, stripeProductId: "prod_s", stripePriceId: "price_s", createdAt: new Date(), updatedAt: new Date() });
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
		expect(row.paidEditorPro).toBe(true);
		expect(row.paidThrough?.getTime()).toBe(periodEnd * 1000);
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

describe("webhook subscription lifecycle", () => {
	it("switches to the billed Pro product only after invoice payment", async () => {
		const oldId = crypto.randomUUID();
		const proId = crypto.randomUUID();
		const oldProduct = `prod_${oldId}`;
		const proProduct = `prod_${proId}`;
		const base = { interval: "month" as const, priceCents: 2000, currency: "eur", creditsPerPeriod: 0, rolloverCap: 0, features: "", isActive: true, sortOrder: 0, createdAt: new Date(), updatedAt: new Date() };
		await db.insert(subscriptionPlans).values([
			{ ...base, id: oldId, name: "Old", stripeProductId: oldProduct, stripePriceId: "price_old" },
			{ ...base, id: proId, name: "Pro", editorPro: true, stripeProductId: proProduct, stripePriceId: "price_new" },
		]);
		await db.insert(networkBilling).values({ networkId, stripeSubscriptionId: "sub_switch", planId: oldId, currentPeriodId: "inv_old", paidThrough: new Date("2999-02-01"), paidEditorPro: false, status: "active", createdAt: new Date(), updatedAt: new Date() });
		expect((await db.select().from(subscriptionPlans).where(eq(subscriptionPlans.stripeProductId, proProduct)))[0]?.id).toBe(proId);
		const end = Math.floor(new Date("2999-02-01").getTime() / 1000);
		const update = await post({ id: "evt_switch", type: "customer.subscription.updated", data: { object: { id: "sub_switch", status: "unpaid", items: { data: [{ price: { product: proProduct } }] } } } });
		expect(update.status).toBe(200);
		let row = (await db.select().from(networkBilling).where(eq(networkBilling.networkId, networkId)))[0]!;
		expect(row.status).toBe("canceled");
		expect(row.planId).toBe(proId);
		expect(row.paidEditorPro).toBe(false);
		await post({ id: "evt_switch_paid", type: "invoice.paid", data: { object: { id: "inv_new", subscription: "sub_switch", billing_reason: "subscription_cycle", lines: { data: [{ period: { end }, price: { product: proProduct } }] } } } });
		row = (await db.select().from(networkBilling).where(eq(networkBilling.networkId, networkId)))[0]!;
		expect(row.paidEditorPro).toBe(true);
		expect(row.paidThrough?.getTime()).toBe(end * 1000);
		expect(row.currentPeriodId).toBe("inv_old");
		await post({ id: "evt_switch_old_late", type: "invoice.paid", data: { object: { id: "inv_old_late", subscription: "sub_switch", billing_reason: "subscription_cycle", lines: { data: [{ period: { end }, price: { product: oldProduct } }] } } } });
		row = (await db.select().from(networkBilling).where(eq(networkBilling.networkId, networkId)))[0]!;
		expect(row.paidEditorPro).toBe(true);
		await db.delete(networkBilling).where(eq(networkBilling.networkId, networkId));
		await db.delete(subscriptionPlans).where(eq(subscriptionPlans.id, oldId));
		await db.delete(subscriptionPlans).where(eq(subscriptionPlans.id, proId));
	});
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

	it("subscription.updated maps the Stripe status + advances the period end", async () => {
		await db.insert(networkBilling).values({ networkId, stripeSubscriptionId: "sub_u", status: "active", createdAt: new Date(), updatedAt: new Date() });
		const periodEnd = Math.floor(new Date("2999-03-01T00:00:00Z").getTime() / 1000);
		// unpaid → canceled (STATUS_MAP); current_period_end is unix seconds → *1000.
		await post({ id: "evt_upd", type: "customer.subscription.updated", data: { object: { id: "sub_u", status: "unpaid", current_period_end: periodEnd } } });
		const [row] = await db.select().from(networkBilling).where(eq(networkBilling.networkId, networkId));
		expect(row.status).toBe("canceled");
		expect(row.currentPeriodEnd?.getTime()).toBe(periodEnd * 1000);
	});
});
