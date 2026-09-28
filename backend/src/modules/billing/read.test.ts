import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { app } from "../../app";
import { db } from "../../db/index";
import { creditPacks, creditPurchases, memberships, networkBilling, networks, subscriptionPlans, users } from "../../db/schema";
import { createNetwork } from "../../lib/networkManager";
import { createSession } from "../../lib/sessionManager";
import { grantCredits } from "../ai/creditsRepo";
import { __setStripeGatewayForTests, type StripeGateway } from "./stripe";

const USER_ID = "usr_billing_read";
const OUTSIDER_ID = "usr_billing_read_out";
const MEMBER_ID = "usr_billing_read_member";
let networkId = "";
let userSession = "";
let outsiderSession = "";
let memberSession = "";
let packId = "";
let planId = "";
let purchaseId = "";

function fake(): StripeGateway {
	return {
		async createProductWithPrice() { return { productId: "prod", priceId: "price" }; },
		async createPriceForProduct() { return { priceId: "price2" }; },
		async updateProductName() {},
		async archivePrice() {},
		async createCustomer() { return { customerId: "cus_test" }; },
		async createCheckoutSession(i) { return { url: `https://checkout.test/${i.mode}/${i.metadata.kind}` }; },
		async createPortalSession() { return { url: "https://portal.test/s" }; },
		constructWebhookEvent() { return { id: "", type: "", data: { object: {} } }; },
	};
}

const cookie = (s: string) => ({ Cookie: `artisan_user_session=${s}`, "Content-Type": "application/json" });

beforeAll(async () => {
	networkId = (await createNetwork("billing-read-net")).id;
	const now = new Date();
	for (const [id, email] of [[USER_ID, "read@example.com"], [OUTSIDER_ID, "out-read@example.com"], [MEMBER_ID, "member-read@example.com"]] as const) {
		await db.insert(users).values({ id, email, name: id, createdAt: now, updatedAt: now }).onConflictDoNothing();
	}
	await db.insert(memberships).values({ id: "mem_billing_read", userId: USER_ID, networkId, role: "owner", createdAt: now }).onConflictDoNothing();
	await db.insert(memberships).values({ id: "mem_billing_read_member", userId: MEMBER_ID, networkId, role: "member", createdAt: now }).onConflictDoNothing();
	userSession = (await createSession(USER_ID)).id;
	outsiderSession = (await createSession(OUTSIDER_ID)).id;
	memberSession = (await createSession(MEMBER_ID)).id;

	packId = crypto.randomUUID();
	planId = crypto.randomUUID();
	purchaseId = crypto.randomUUID();

	// Pack with 500 credits + 20% bonus = 600 credits granted
	await db.insert(creditPacks).values({ id: packId, name: "P", priceCents: 1000, currency: "eur", credits: 500, bonusPct: 20, isActive: true, sortOrder: 0, stripeProductId: "prod_p", stripePriceId: "price_p", createdAt: now, updatedAt: now });
	await db.insert(subscriptionPlans).values({ audience: "public", publicationStatus: "published", id: planId, name: "Pro", interval: "month", priceCents: 2000, currency: "eur", creditsPerPeriod: 5000, rolloverCap: 0, features: "", isActive: true, sortOrder: 0, stripeProductId: "prod_s", stripePriceId: "price_s", createdAt: now, updatedAt: now });

	// Network billing with active subscription
	const periodEnd = new Date();
	periodEnd.setMonth(periodEnd.getMonth() + 1);
	await db.insert(networkBilling).values({ networkId, stripeCustomerId: "cus_test", planId, status: "active", currentPeriodEnd: periodEnd, graceUntil: null, createdAt: now, updatedAt: now });

	// Seed credit ledger entries
	await grantCredits({ networkId, amount: 100, bucket: "subscription", expiresAt: new Date("2999-01-01"), periodId: "p1" });
	await grantCredits({ networkId, amount: 50, bucket: "topup" });

	// Credit purchase entry
	await db.insert(creditPurchases).values({ id: purchaseId, networkId, packId, stripeSessionId: "sess_test", stripeInvoiceUrl: "https://invoice.stripe.com/test", amountCents: 1000, currency: "eur", credits: 600, createdBy: USER_ID, createdAt: now });

	__setStripeGatewayForTests(fake());
});

afterAll(async () => {
	__setStripeGatewayForTests(null);
	await db.delete(creditPurchases).where(eq(creditPurchases.networkId, networkId));
	await db.delete(networkBilling).where(eq(networkBilling.networkId, networkId));
	await db.delete(networks).where(eq(networks.id, networkId)); // cascades memberships
	await db.delete(users).where(eq(users.id, USER_ID));
	await db.delete(users).where(eq(users.id, OUTSIDER_ID));
	await db.delete(users).where(eq(users.id, MEMBER_ID));
	await db.delete(creditPacks).where(eq(creditPacks.id, packId));
	await db.delete(subscriptionPlans).where(eq(subscriptionPlans.id, planId));
});

describe("billing read routes", () => {
	it("401 without a session (balance)", async () => {
		expect((await app.request(`/api/v1/billing/balance?networkId=${networkId}`)).status).toBe(401);
	});

	it("GET /billing/balance returns per-bucket balances (member only)", async () => {
		const res = await app.request(`/api/v1/billing/balance?networkId=${networkId}`, { headers: cookie(userSession) });
		expect(res.status).toBe(200);
		const b = await res.json();
		expect(b.total).toBe(150);
		expect(b.subscription).toBe(100);
		expect(b.topup).toBe(50);
		const out = await app.request(`/api/v1/billing/balance?networkId=${networkId}`, { headers: cookie(outsiderSession) });
		expect(out.status).toBe(403);
	});

	it("GET /billing/balance reports the monthly credit reset for an annual paid cycle", async () => {
		const start = new Date("2026-01-31T00:00:00Z");
		const paidThrough = new Date("2027-01-31T00:00:00Z");
		const [original] = await db.select({ currentPeriodEnd: networkBilling.currentPeriodEnd }).from(networkBilling).where(eq(networkBilling.networkId, networkId));
		await db.update(networkBilling).set({ creditCycleStart: start, creditMonthIndex: 0, paidThrough, currentPeriodEnd: paidThrough }).where(eq(networkBilling.networkId, networkId));
		try {
			const res = await app.request(`/api/v1/billing/balance?networkId=${networkId}`, { headers: cookie(userSession) });
			expect((await res.json()).periodEnd).toBe("2026-02-28T00:00:00.000Z");
		} finally {
			await db.update(networkBilling).set({ creditCycleStart: null, creditMonthIndex: null, paidThrough: null, currentPeriodEnd: original.currentPeriodEnd }).where(eq(networkBilling.networkId, networkId));
		}
	});

	it("GET /billing/packs lists active packs with creditsGranted (bonus applied), no Stripe ids", async () => {
		const res = await app.request("/api/v1/billing/packs", { headers: cookie(userSession) });
		expect(res.status).toBe(200);
		const { packs } = await res.json();
		expect(packs.length).toBeGreaterThan(0);
		expect(JSON.stringify(packs)).not.toContain("stripe");
		// pack seeded with credits 500 bonus 20 → creditsGranted 600
		expect(packs.find((p: { creditsGranted: number }) => p.creditsGranted === 600)).toBeTruthy();
	});

	it("GET /billing/plans lists active plans, no Stripe ids", async () => {
		const res = await app.request("/api/v1/billing/plans", { headers: cookie(userSession) });
		expect(res.status).toBe(200);
		const { plans } = await res.json();
		expect(plans.length).toBeGreaterThan(0);
		expect(JSON.stringify(plans)).not.toContain("stripe");
		expect(plans.find((p: { id: string }) => p.id === planId)).toBeTruthy();
	});

	it("GET /billing/subscription reflects network_billing", async () => {
		const res = await app.request(`/api/v1/billing/subscription?networkId=${networkId}`, { headers: cookie(userSession) });
		expect(res.status).toBe(200);
		const s = await res.json();
		expect(s.status).toBe("active");
		expect(s.planId).toBe(planId);
		expect(s.planName).toBe("Pro");
		expect(s.effectivePlan).toMatchObject({ id: null, key: "free", name: "Free", limits: { resourcesPerServer: 10 } });
		const out = await app.request(`/api/v1/billing/subscription?networkId=${networkId}`, { headers: cookie(outsiderSession) });
		expect(out.status).toBe(403);
	});

	it("reports effective paid version until expiry, then Free without changing billing status", async () => {
		await db.update(networkBilling).set({ currentPeriodId: "confirmed", paidThrough: new Date("2999-01-01") }).where(eq(networkBilling.networkId, networkId));
		try {
			let res = await app.request(`/api/v1/billing/subscription?networkId=${networkId}`, { headers: cookie(userSession) });
			expect((await res.json()).effectivePlan).toMatchObject({ id: planId, name: "Pro" });
			await db.update(networkBilling).set({ paidThrough: new Date("2000-01-01") }).where(eq(networkBilling.networkId, networkId));
			res = await app.request(`/api/v1/billing/subscription?networkId=${networkId}`, { headers: cookie(userSession) });
			expect(await res.json()).toMatchObject({ status: "active", effectivePlan: { id: null, key: "free", name: "Free" } });
		} finally {
			await db.update(networkBilling).set({ currentPeriodId: null, paidThrough: null }).where(eq(networkBilling.networkId, networkId));
		}
	});

	it("reports Free for a Network without a billing record", async () => {
		const free = await createNetwork("free-read-net");
		await db.insert(memberships).values({ id: "free-read-member", userId: USER_ID, networkId: free.id, role: "owner", createdAt: new Date() });
		try {
			const res = await app.request(`/api/v1/billing/subscription?networkId=${free.id}`, { headers: cookie(userSession) });
			expect(await res.json()).toMatchObject({ status: null, effectivePlan: { id: null, key: "free", name: "Free", limits: { servers: 2, resourcesPerServer: 10, collaborators: 2 } } });
		} finally {
			await db.delete(networks).where(eq(networks.id, free.id));
		}
	});

	it("GET /billing/purchases lists the network's purchases newest first", async () => {
		const res = await app.request(`/api/v1/billing/purchases?networkId=${networkId}`, { headers: cookie(userSession) });
		expect(res.status).toBe(200);
		const { purchases } = await res.json();
		expect(purchases.length).toBeGreaterThan(0);
		expect(purchases[0].id).toBe(purchaseId);
		expect(typeof purchases[0].createdAt).toBe("string");
		expect(purchases[0].credits).toBe(600);
		const out = await app.request(`/api/v1/billing/purchases?networkId=${networkId}`, { headers: cookie(outsiderSession) });
		expect(out.status).toBe(403);
	});

	it("member role → 403 on purchases (lacks manage_billing)", async () => {
		const res = await app.request(`/api/v1/billing/purchases?networkId=${networkId}`, { headers: cookie(memberSession) });
		expect(res.status).toBe(403);
	});

	it("member role → 200 on balance (member-facing)", async () => {
		const res = await app.request(`/api/v1/billing/balance?networkId=${networkId}`, { headers: cookie(memberSession) });
		expect(res.status).toBe(200);
	});
});
