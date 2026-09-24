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
const MEMBER_ID = "usr_billing_member";
let networkId = "";
let userSession = "";
let outsiderSession = "";
let memberSession = "";
let packId = "";
let planId = "";

let lastCheckout: any = null;
let lastPortal: Parameters<StripeGateway["createPortalSession"]>[0] | null = null;

function fake(): StripeGateway {
	return {
		async createProductWithPrice() { return { productId: "prod", priceId: "price" }; },
		async createPriceForProduct() { return { priceId: "price2" }; },
		async updateProductName() {},
		async archivePrice() {},
		async createCustomer() { return { customerId: "cus_test" }; },
		async createCheckoutSession(i) { lastCheckout = i; return { url: `https://checkout.test/${i.mode}/${i.metadata.kind}` }; },
		async createPortalSession(i) { lastPortal = i; return { url: "https://portal.test/s" }; },
		constructWebhookEvent() { return { id: "", type: "", data: { object: {} } }; },
	};
}

const cookie = (s: string) => ({ Cookie: `artisan_user_session=${s}`, "Content-Type": "application/json" });

beforeAll(async () => {
	networkId = (await createNetwork("billing-co-net")).id;
	const now = new Date();
	for (const [id, email] of [[USER_ID, "co@example.com"], [OUTSIDER_ID, "out@example.com"], [MEMBER_ID, "member-co@example.com"]] as const) {
		await db.insert(users).values({ id, email, name: id, createdAt: now, updatedAt: now }).onConflictDoNothing();
	}
	await db.insert(memberships).values({ id: "mem_billing_co", userId: USER_ID, networkId, role: "owner", createdAt: now }).onConflictDoNothing();
	await db.insert(memberships).values({ id: "mem_billing_co_member", userId: MEMBER_ID, networkId, role: "member", createdAt: now }).onConflictDoNothing();
	userSession = (await createSession(USER_ID)).id;
	outsiderSession = (await createSession(OUTSIDER_ID)).id;
	memberSession = (await createSession(MEMBER_ID)).id;
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
	await db.delete(users).where(eq(users.id, MEMBER_ID));
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

	it("subscription checkout returns to the selected network and plan on success or cancellation", async () => {
		const res = await app.request("/api/v1/billing/checkout/subscription", { method: "POST", headers: cookie(userSession), body: JSON.stringify({ networkId, planId }) });
		expect(res.status).toBe(200);
		for (const [key, state] of [["successUrl", "success"], ["cancelUrl", "cancel"]]) {
			const url = new URL(lastCheckout[key]);
			expect(url.pathname).toBe("/credits");
			expect(url.searchParams.get("checkout")).toBe(state);
			expect(url.searchParams.get("networkId")).toBe(networkId);
			expect(url.searchParams.get("plan")).toBe(planId);
		}
	});

	it.each(["active", "trialing", "past_due", "unpaid", "paused", "incomplete", null])("a %s subscription must be managed in the portal instead of starting another checkout", async (status) => {
		await db.update(networkBilling).set({ stripeSubscriptionId: "sub_existing", status, planId }).where(eq(networkBilling.networkId, networkId));
		lastCheckout = null;
		try {
			const res = await app.request("/api/v1/billing/checkout/subscription", { method: "POST", headers: cookie(userSession), body: JSON.stringify({ networkId, planId }) });
			expect(res.status).toBe(409);
			expect(await res.json()).toEqual({ error: "subscription_exists" });
			expect(lastCheckout).toBeNull();
		} finally {
			await db.update(networkBilling).set({ stripeSubscriptionId: null, status: null, planId: null }).where(eq(networkBilling.networkId, networkId));
		}
	});

	it.each(["canceled", "incomplete_expired"])("a %s subscription allows a fresh checkout", async (status) => {
		await db.update(networkBilling).set({ stripeSubscriptionId: "sub_old", status, planId }).where(eq(networkBilling.networkId, networkId));
		lastCheckout = null;
		try {
			const res = await app.request("/api/v1/billing/checkout/subscription", { method: "POST", headers: cookie(userSession), body: JSON.stringify({ networkId, planId }) });
			expect(res.status).toBe(200);
			expect(lastCheckout.mode).toBe("subscription");
		} finally {
			await db.update(networkBilling).set({ stripeSubscriptionId: null, status: null, planId: null }).where(eq(networkBilling.networkId, networkId));
		}
	});

	it("configured checkout URLs keep their query, fragment and Stripe session placeholder", async () => {
		const previous = process.env.BILLING_SUCCESS_URL;
		process.env.BILLING_SUCCESS_URL = "https://editor.example/credits?checkout=success&networkId=stale&session_id={CHECKOUT_SESSION_ID}#receipt";
		try {
			const res = await app.request("/api/v1/billing/checkout/subscription", { method: "POST", headers: cookie(userSession), body: JSON.stringify({ networkId, planId }) });
			expect(res.status).toBe(200);
			const url = new URL(lastCheckout.successUrl);
			expect(url.origin).toBe("https://editor.example");
			expect(url.hash).toBe("#receipt");
			expect(url.searchParams.getAll("networkId")).toEqual([networkId]);
			expect(url.searchParams.get("plan")).toBe(planId);
			expect(lastCheckout.successUrl).toContain("session_id={CHECKOUT_SESSION_ID}");
		} finally {
			if (previous === undefined) delete process.env.BILLING_SUCCESS_URL;
			else process.env.BILLING_SUCCESS_URL = previous;
		}
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
		expect(new URL(lastPortal!.returnUrl).searchParams.get("networkId")).toBe(networkId);
	});

	it("member role → 403 on portal (lacks manage_billing)", async () => {
		const res = await app.request("/api/v1/billing/portal", { method: "POST", headers: cookie(memberSession), body: JSON.stringify({ networkId }) });
		expect(res.status).toBe(403);
	});

	it("member role → 403 on pack checkout (lacks manage_billing)", async () => {
		const res = await app.request("/api/v1/billing/checkout/pack", { method: "POST", headers: cookie(memberSession), body: JSON.stringify({ networkId, packId }) });
		expect(res.status).toBe(403);
	});

	it("member role cannot start a subscription checkout", async () => {
		lastCheckout = null;
		const res = await app.request("/api/v1/billing/checkout/subscription", { method: "POST", headers: cookie(memberSession), body: JSON.stringify({ networkId, planId }) });
		expect(res.status).toBe(403);
		expect(lastCheckout).toBeNull();
	});
});
