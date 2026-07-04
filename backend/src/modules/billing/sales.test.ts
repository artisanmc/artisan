import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { app } from "../../app";
import { db } from "../../db/index";
import { aiCreditLedger, creditPurchases, networkBilling, networks, subscriptionPlans, users } from "../../db/schema";
import { createNetwork } from "../../lib/networkManager";
import { createSession } from "../../lib/sessionManager";
import { salesSummary } from "./salesRepo";

let networkId = ""; const planId = crypto.randomUUID();
const ADMIN_ID = "user_admin_sales";
let adminSession = "";

beforeAll(async () => {
	networkId = (await createNetwork("sales-net")).id;
	const now = new Date();
	await db.insert(subscriptionPlans).values({ id: planId, name: "Pro", interval: "month", priceCents: 2000, currency: "eur", creditsPerPeriod: 5000, rolloverCap: 1000, features: "", isActive: true, sortOrder: 0, stripeProductId: "p", stripePriceId: "pr", createdAt: now, updatedAt: now });
	await db.insert(networkBilling).values({ networkId, planId, status: "active", stripeCustomerId: "c", stripeSubscriptionId: "s", createdAt: now, updatedAt: now });
	await db.insert(creditPurchases).values([
		{ id: crypto.randomUUID(), networkId, packId: null, stripeSessionId: "cs_a", amountCents: 1000, currency: "eur", credits: 600, createdAt: new Date("2026-07-02T10:00:00Z") },
		{ id: crypto.randomUUID(), networkId, packId: null, stripeSessionId: "cs_b", amountCents: 2500, currency: "eur", credits: 1500, createdAt: new Date("2026-07-03T10:00:00Z") },
	]);

	await db.insert(users).values({ id: ADMIN_ID, email: `${ADMIN_ID}@example.com`, name: "Admin", isAdmin: true, createdAt: now, updatedAt: now }).onConflictDoNothing();
	adminSession = (await createSession(ADMIN_ID)).id;
});
afterAll(async () => {
	await db.delete(aiCreditLedger).where(eq(aiCreditLedger.networkId, networkId));
	await db.delete(creditPurchases).where(eq(creditPurchases.networkId, networkId));
	await db.delete(networkBilling).where(eq(networkBilling.networkId, networkId));
	await db.delete(subscriptionPlans).where(eq(subscriptionPlans.id, planId));
	await db.delete(networks).where(eq(networks.id, networkId));
	await db.delete(users).where(eq(users.id, ADMIN_ID));
});

const adminHeaders = () => ({ Cookie: `artisan_user_session=${adminSession}`, "Content-Type": "application/json" });

describe("salesSummary", () => {
	it("aggregates top-up revenue per currency + active subscribers per plan", async () => {
		const s = await salesSummary(new Date("2026-07-01T00:00:00Z"), new Date("2026-07-04T00:00:00Z"));
		expect(s.topups.count).toBe(2);
		expect(s.topups.byCurrency.eur).toBe(3500);
		expect(s.subscriptions.activeCount).toBe(1);
		expect(s.subscriptions.mrrByCurrency.eur).toBe(2000);
		expect(s.subscriptions.perPlan.find((p) => p.planId === planId)?.activeCount).toBe(1);
		expect(s.daily.length).toBe(2);
	});
	it("excludes purchases outside the window", async () => {
		const s = await salesSummary(new Date("2026-07-03T00:00:00Z"), new Date("2026-07-04T00:00:00Z"));
		expect(s.topups.count).toBe(1);
		expect(s.topups.byCurrency.eur).toBe(2500);
	});
});

describe("admin sales + grant routes", () => {
	it("GET /admin/billing/sales returns the summary", async () => {
		const res = await app.request(`/api/v1/admin/billing/sales?from=2026-07-01T00:00:00Z&to=2026-07-04T00:00:00Z`, { headers: adminHeaders() });
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.topups.byCurrency.eur).toBe(3500);
		expect(body.subscriptions.activeCount).toBe(1);
	});

	it("GET /admin/billing/sales defaults to a 30-day window and rejects invalid dates", async () => {
		const res = await app.request(`/api/v1/admin/billing/sales`, { headers: adminHeaders() });
		expect(res.status).toBe(200);
		const bad = await app.request(`/api/v1/admin/billing/sales?from=not-a-date`, { headers: adminHeaders() });
		expect(bad.status).toBe(400);
		expect((await bad.json()).error).toBe("invalid_range");
	});

	it("POST /admin/billing/grant grants a manual top-up and records a ledger entry", async () => {
		const res = await app.request(`/api/v1/admin/billing/grant`, {
			method: "POST", headers: adminHeaders(),
			body: JSON.stringify({ networkId, amount: 500, note: "goodwill" }),
		});
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.ok).toBe(true);
		expect(typeof body.balance).toBe("number");
		const rows = await db.select().from(aiCreditLedger).where(eq(aiCreditLedger.networkId, networkId));
		const grant = rows.find((r) => r.bucket === "topup" && r.reason === "adjustment" && r.delta === 500);
		expect(grant).toBeDefined();
		expect(grant?.note).toBe("goodwill");
	});

	it("POST /admin/billing/grant 400 on non-positive/non-integer amount", async () => {
		const res = await app.request(`/api/v1/admin/billing/grant`, {
			method: "POST", headers: adminHeaders(),
			body: JSON.stringify({ networkId, amount: 0 }),
		});
		expect(res.status).toBe(400);
		expect((await res.json()).error).toBe("invalid_amount");
		const res2 = await app.request(`/api/v1/admin/billing/grant`, {
			method: "POST", headers: adminHeaders(),
			body: JSON.stringify({ networkId, amount: 1.5 }),
		});
		expect(res2.status).toBe(400);
	});

	it("POST /admin/billing/grant 404 for unknown network", async () => {
		const res = await app.request(`/api/v1/admin/billing/grant`, {
			method: "POST", headers: adminHeaders(),
			body: JSON.stringify({ networkId: "nope", amount: 100 }),
		});
		expect(res.status).toBe(404);
		expect((await res.json()).error).toBe("network_not_found");
	});
});
