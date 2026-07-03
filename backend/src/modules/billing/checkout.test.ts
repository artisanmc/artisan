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

let lastCheckout: any = null;

function fake(): StripeGateway {
	return {
		async createProductWithPrice() { return { productId: "prod", priceId: "price" }; },
		async createPriceForProduct() { return { priceId: "price2" }; },
		async updateProductName() {},
		async archivePrice() {},
		async createCustomer() { return { customerId: "cus_test" }; },
		async createCheckoutSession(i) { lastCheckout = i; return { url: `https://checkout.test/${i.mode}/${i.metadata.kind}` }; },
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
		expect(lastCheckout.metadata).toEqual({ networkId, kind: "pack", packId, userId: USER_ID });
	});

	it("subscription checkout uses mode=subscription", async () => {
		const res = await app.request("/api/v1/billing/checkout/subscription", { method: "POST", headers: cookie(userSession), body: JSON.stringify({ networkId, planId }) });
		expect(res.status).toBe(200);
		expect((await res.json()).url).toContain("checkout.test/subscription/subscription");
		expect(lastCheckout.metadata).toEqual({ networkId, kind: "subscription", planId, userId: USER_ID });
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
