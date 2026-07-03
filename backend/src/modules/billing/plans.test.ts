import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { app } from "../../app";
import { db } from "../../db/index";
import { subscriptionPlans, users } from "../../db/schema";
import { createSession } from "../../lib/sessionManager";
import { __setStripeGatewayForTests, type StripeGateway } from "./stripe";

const ADMIN_ID = "user_admin_plans";
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

afterEach(async () => {
	await db.delete(subscriptionPlans);
	__setStripeGatewayForTests(fakeGateway());
});

afterAll(async () => {
	__setStripeGatewayForTests(null);
	await db.delete(users).where(eq(users.id, ADMIN_ID));
});

const adminHeaders = () => ({ Cookie: `artisan_user_session=${adminSession}`, "Content-Type": "application/json" });

describe("admin plans routes", () => {
	it("403 without admin", async () => {
		expect((await app.request("/api/v1/admin/billing/plans")).status).toBe(403);
	});

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

	it("GET lists all plans sorted by sortOrder", async () => {
		const post1 = await app.request("/api/v1/admin/billing/plans", {
			method: "POST", headers: adminHeaders(),
			body: JSON.stringify({ name: "Starter", priceCents: 500, creditsPerPeriod: 1000, sortOrder: 1 }),
		});
		const plan1 = await post1.json();

		const post2 = await app.request("/api/v1/admin/billing/plans", {
			method: "POST", headers: adminHeaders(),
			body: JSON.stringify({ name: "Pro", priceCents: 2000, creditsPerPeriod: 5000, sortOrder: 2 }),
		});
		const plan2 = await post2.json();

		const list = await (await app.request("/api/v1/admin/billing/plans", { headers: adminHeaders() })).json();
		expect(list.plans.length).toBe(2);
		expect(list.plans[0].name).toBe("Starter");
		expect(list.plans[1].name).toBe("Pro");
		expect(typeof list.plans[0].createdAt).toBe("string");
	});

	it("GET /billing/plans/:id retrieves a single plan", async () => {
		const post = await app.request("/api/v1/admin/billing/plans", {
			method: "POST", headers: adminHeaders(),
			body: JSON.stringify({ name: "Solo", priceCents: 1000, creditsPerPeriod: 2000 }),
		});
		const created = await post.json();

		const get = await app.request(`/api/v1/admin/billing/plans/${created.id}`, { headers: adminHeaders() });
		expect(get.status).toBe(200);
		const fetched = await get.json();
		expect(fetched.name).toBe("Solo");
		expect(fetched.priceCents).toBe(1000);
	});

	it("PUT updates plan fields without re-provisioning if price/interval unchanged", async () => {
		const post = await app.request("/api/v1/admin/billing/plans", {
			method: "POST", headers: adminHeaders(),
			body: JSON.stringify({ name: "P", priceCents: 1000, creditsPerPeriod: 500, features: "" }),
		});
		const created = await post.json();
		const oldPriceId = created.stripePriceId;

		const put = await app.request(`/api/v1/admin/billing/plans/${created.id}`, {
			method: "PUT", headers: adminHeaders(),
			body: JSON.stringify({ creditsPerPeriod: 750, features: "priority support" }),
		});
		expect(put.status).toBe(200);
		const updated = await put.json();
		expect(updated.creditsPerPeriod).toBe(750);
		expect(updated.features).toBe("priority support");
		expect(updated.stripePriceId).toBe(oldPriceId); // no re-provisioning
	});

	it("PUT re-provisions when price changes", async () => {
		const post = await app.request("/api/v1/admin/billing/plans", {
			method: "POST", headers: adminHeaders(),
			body: JSON.stringify({ name: "P", priceCents: 1000, creditsPerPeriod: 500 }),
		});
		const created = await post.json();
		const oldPriceId = created.stripePriceId;

		const put = await app.request(`/api/v1/admin/billing/plans/${created.id}`, {
			method: "PUT", headers: adminHeaders(),
			body: JSON.stringify({ priceCents: 2000 }),
		});
		expect(put.status).toBe(200);
		const updated = await put.json();
		expect(updated.priceCents).toBe(2000);
		expect(updated.stripePriceId).not.toBe(oldPriceId); // new price provisioned
	});

	it("PUT re-provisions when interval changes", async () => {
		const post = await app.request("/api/v1/admin/billing/plans", {
			method: "POST", headers: adminHeaders(),
			body: JSON.stringify({ name: "P", priceCents: 1000, creditsPerPeriod: 500, interval: "month" }),
		});
		const created = await post.json();
		const oldPriceId = created.stripePriceId;

		const put = await app.request(`/api/v1/admin/billing/plans/${created.id}`, {
			method: "PUT", headers: adminHeaders(),
			body: JSON.stringify({ interval: "year" }),
		});
		expect(put.status).toBe(200);
		const updated = await put.json();
		expect(updated.interval).toBe("year");
		expect(updated.stripePriceId).not.toBe(oldPriceId); // new price provisioned
	});

	it("POST /billing/plans/:id/deactivate flips isActive", async () => {
		const post = await app.request("/api/v1/admin/billing/plans", {
			method: "POST", headers: adminHeaders(),
			body: JSON.stringify({ name: "P", priceCents: 1000, creditsPerPeriod: 500 }),
		});
		const created = await post.json();
		expect(created.isActive).toBe(true);

		const res = await app.request(`/api/v1/admin/billing/plans/${created.id}/deactivate`, { method: "POST", headers: adminHeaders() });
		expect(res.status).toBe(200);
		const [row] = await db.select().from(subscriptionPlans).where(eq(subscriptionPlans.id, created.id));
		expect(row.isActive).toBe(false);
	});

	it("PUT validates (empty name / non-positive price / negative rolloverCap → 400)", async () => {
		const post = await app.request("/api/v1/admin/billing/plans", {
			method: "POST", headers: adminHeaders(),
			body: JSON.stringify({ name: "P", priceCents: 1000, creditsPerPeriod: 500 }),
		});
		const created = await post.json();

		const badName = await app.request(`/api/v1/admin/billing/plans/${created.id}`, {
			method: "PUT", headers: adminHeaders(),
			body: JSON.stringify({ name: "" }),
		});
		expect(badName.status).toBe(400);

		const badPrice = await app.request(`/api/v1/admin/billing/plans/${created.id}`, {
			method: "PUT", headers: adminHeaders(),
			body: JSON.stringify({ priceCents: 0 }),
		});
		expect(badPrice.status).toBe(400);

		const badRollover = await app.request(`/api/v1/admin/billing/plans/${created.id}`, {
			method: "PUT", headers: adminHeaders(),
			body: JSON.stringify({ rolloverCap: -10 }),
		});
		expect(badRollover.status).toBe(400);
	});

	it("PUT 404 if plan not found", async () => {
		const res = await app.request("/api/v1/admin/billing/plans/nonexistent", {
			method: "PUT", headers: adminHeaders(),
			body: JSON.stringify({ name: "X" }),
		});
		expect(res.status).toBe(404);
	});

	it("POST /billing/plans/:id/deactivate 404 if plan not found", async () => {
		const res = await app.request("/api/v1/admin/billing/plans/nonexistent/deactivate", { method: "POST", headers: adminHeaders() });
		expect(res.status).toBe(404);
	});
});
