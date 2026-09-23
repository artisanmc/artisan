import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { app } from "../../app";
import { db } from "../../db/index";
import { subscriptionPlans, users } from "../../db/schema";
import { createSession } from "../../lib/sessionManager";
import { __setStripeGatewayForTests, type StripeGateway } from "./stripe";

const ADMIN_ID = "user_admin_plans";
let adminSession = "";
let archived: string[] = [];

function fakeGateway(): StripeGateway {
	let n = 0;
	return {
		async createProductWithPrice() { n++; return { productId: `prod_${n}`, priceId: `price_${n}` }; },
		async createPriceForProduct() { return { priceId: `price_reuse_${n}` }; },
		async updateProductName() {},
		async archivePrice(id: string) { archived.push(id); },
		async createCustomer() { return { customerId: "c" }; },
		async createCheckoutSession() { return { url: "u" }; },
		async createPortalSession() { return { url: "u" }; },
		constructWebhookEvent() { return { id: "", type: "", data: { object: {} } }; },
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
	archived = [];
	__setStripeGatewayForTests(fakeGateway());
});

afterAll(async () => {
	__setStripeGatewayForTests(null);
	await db.delete(users).where(eq(users.id, ADMIN_ID));
});

const adminHeaders = () => ({ Cookie: `artisan_user_session=${adminSession}`, "Content-Type": "application/json" });

describe("admin plans routes", () => {
	it("public catalog exposes saved presentation and exact prices, hides inactive plans, and sorts consistently", async () => {
		const base = { name: "Monthly", priceCents: 1200, creditsPerPeriod: 1500 };
		const created = [];
		for (const input of [
			{ ...base, name: "Hidden", isActive: false, sortOrder: -5 },
			{ ...base, name: "Annual", interval: "year", priceCents: 12000, currency: "usd", description: "Annual access", highlighted: true, features: "First benefit\nSecond benefit", sortOrder: 3 },
			{ ...base, sortOrder: -1 },
		]) {
			created.push(await (await app.request("/api/v1/admin/billing/plans", {
				method: "POST", headers: adminHeaders(), body: JSON.stringify(input),
			})).json());
		}
		const response = await app.request("/api/v1/billing/plans");
		expect(response.status).toBe(200);
		const { plans } = await response.json();
		expect(plans.map((plan: { id: string }) => plan.id)).toEqual([created[2].id, created[1].id]);
		expect(plans[0]).toMatchObject({ description: "", highlighted: false, interval: "month", priceCents: 1200, currency: "eur", sortOrder: -1 });
		expect(plans[1]).toMatchObject({ description: "Annual access", highlighted: true, interval: "year", priceCents: 12000, currency: "usd", creditsPerPeriod: 1500, features: "First benefit\nSecond benefit", sortOrder: 3 });
		expect(JSON.stringify(plans)).not.toContain("stripe");
	});

	it("rejects malformed presentation settings on create and update", async () => {
		const base = { name: "Pro", priceCents: 1200, creditsPerPeriod: 1500 };
		const created = await (await app.request("/api/v1/admin/billing/plans", {
			method: "POST", headers: adminHeaders(), body: JSON.stringify(base),
		})).json();
		for (const patch of [{ description: 12 }, { description: "x".repeat(241) }, { highlighted: "true" }, { sortOrder: 1.5 }, { features: ["Unexpected array"] }]) {
			for (const method of ["POST", "PUT"]) {
				const response = await app.request(`/api/v1/admin/billing/plans${method === "PUT" ? `/${created.id}` : ""}`, {
					method, headers: adminHeaders(), body: JSON.stringify({ ...base, ...patch }),
				});
				expect(response.status).toBe(400);
			}
		}
	});

	it("publishes admin presentation settings without changing the Stripe price", async () => {
		const response = await app.request("/api/v1/admin/billing/plans", {
			method: "POST", headers: adminHeaders(),
			body: JSON.stringify({
				name: "Pro", interval: "year", priceCents: 12000, creditsPerPeriod: 1500,
				description: "  More room to create  ", highlighted: true,
				features: "1500 credits per year\nShared network balance", sortOrder: 5,
			}),
		});
		expect(response.status).toBe(200);
		const created = await response.json();
		expect(created.description).toBe("More room to create");
		expect(created.highlighted).toBe(true);
		const updatedResponse = await app.request(`/api/v1/admin/billing/plans/${created.id}`, {
			method: "PUT", headers: adminHeaders(),
			body: JSON.stringify({ description: "A fresh description", highlighted: false, sortOrder: -1 }),
		});
		expect(updatedResponse.status).toBe(200);
		const updated = await updatedResponse.json();
		expect(updated.description).toBe("A fresh description");
		expect(updated.highlighted).toBe(false);
		expect(updated.stripePriceId).toBe(created.stripePriceId);
		expect(archived).toEqual([]);
		const fetched = await (await app.request(`/api/v1/admin/billing/plans/${created.id}`, { headers: adminHeaders() })).json();
		expect(fetched.description).toBe(updated.description);
		expect(fetched.features).toBe(created.features);
	});

	it("403 without admin", async () => {
		expect((await app.request("/api/v1/admin/billing/plans")).status).toBe(403);
	});

	it("POST creates a plan + provisions a RECURRING Stripe price", async () => {
		let recurringSeen: unknown = null;
		__setStripeGatewayForTests({
			async createProductWithPrice(input) { recurringSeen = input.recurring; return { productId: "prod_s", priceId: "price_s" }; },
			async createPriceForProduct() { return { priceId: "price_s2" }; },
			async updateProductName() {},
			async archivePrice() {},
			async createCustomer() { return { customerId: "c" }; },
			async createCheckoutSession() { return { url: "u" }; },
			async createPortalSession() { return { url: "u" }; },
			constructWebhookEvent() { return { id: "", type: "", data: { object: {} } }; },
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

	it("POST validates (missing name / non-positive price / non-positive creditsPerPeriod / negative rolloverCap → 400)", async () => {
		for (const body of [
			{ name: "", priceCents: 2000, creditsPerPeriod: 100 },
			{ name: "X", priceCents: 0, creditsPerPeriod: 100 },
			{ name: "X", priceCents: 2000, creditsPerPeriod: 0 },
			{ name: "X", priceCents: 2000, creditsPerPeriod: -5 },
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

	it("GET /billing/plans/:id retrieves a single plan; 404 for unknown", async () => {
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

		const missing = await app.request("/api/v1/admin/billing/plans/nope", { headers: adminHeaders() });
		expect(missing.status).toBe(404);
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
		expect(archived).toContain(oldPriceId); // old price archived
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
		expect(archived).toContain(oldPriceId); // old price archived
	});

	it("PUT re-provisions when only the currency changes", async () => {
		const post = await app.request("/api/v1/admin/billing/plans", {
			method: "POST", headers: adminHeaders(),
			body: JSON.stringify({ name: "P", priceCents: 1000, creditsPerPeriod: 500, currency: "eur" }),
		});
		const created = await post.json();
		const oldPriceId = created.stripePriceId;
		expect(created.currency).toBe("eur");

		const put = await app.request(`/api/v1/admin/billing/plans/${created.id}`, {
			method: "PUT", headers: adminHeaders(),
			body: JSON.stringify({ currency: "usd" }),
		});
		expect(put.status).toBe(200);
		const updated = await put.json();
		expect(updated.currency).toBe("usd");
		expect(updated.stripePriceId).not.toBe(oldPriceId); // new price provisioned
		expect(archived).toContain(oldPriceId); // old price archived
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

	it("PUT validates (empty name / non-positive price / non-positive creditsPerPeriod / negative rolloverCap → 400)", async () => {
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

		const badCredits = await app.request(`/api/v1/admin/billing/plans/${created.id}`, {
			method: "PUT", headers: adminHeaders(),
			body: JSON.stringify({ creditsPerPeriod: 0 }),
		});
		expect(badCredits.status).toBe(400);

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

	it("PUT reuses the existing Stripe product on reprice (no orphan product) and archives the old price", async () => {
		const products: string[] = [];
		const priced: string[] = [];
		const renamed: Array<[string, string]> = [];
		const archived2: string[] = [];
		__setStripeGatewayForTests({
			async createProductWithPrice() { const p = `prod_${products.length}`; products.push(p); return { productId: p, priceId: `price_${priced.push(p)}` }; },
			async createPriceForProduct(i) { priced.push(i.productId); return { priceId: `price_reuse_${priced.length}` }; },
			async updateProductName(id, name) { renamed.push([id, name]); },
			async archivePrice(id) { archived2.push(id); },
			async createCustomer() { return { customerId: "c" }; },
			async createCheckoutSession() { return { url: "u" }; },
			async createPortalSession() { return { url: "u" }; },
			constructWebhookEvent() { return { id: "", type: "", data: { object: {} } }; },
		});
		const created = await (await app.request("/api/v1/admin/billing/plans", { method: "POST", headers: adminHeaders(), body: JSON.stringify({ name: "P", priceCents: 1000, creditsPerPeriod: 500 }) })).json();
		const productCountAfterCreate = products.length;
		const put = await app.request(`/api/v1/admin/billing/plans/${created.id}`, { method: "PUT", headers: adminHeaders(), body: JSON.stringify({ priceCents: 2000 }) });
		const updated = await put.json();
		expect(products.length).toBe(productCountAfterCreate); // NO new product created on reprice
		expect(updated.stripePriceId).not.toBe(created.stripePriceId);
		expect(archived2).toContain(created.stripePriceId);
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
			constructWebhookEvent() { return { id: "", type: "", data: { object: {} } }; },
		});
		const created = await (await app.request("/api/v1/admin/billing/plans", { method: "POST", headers: adminHeaders(), body: JSON.stringify({ name: "Old", priceCents: 1000, creditsPerPeriod: 500 }) })).json();
		await app.request(`/api/v1/admin/billing/plans/${created.id}`, { method: "PUT", headers: adminHeaders(), body: JSON.stringify({ name: "New" }) });
		expect(renamed).toContainEqual(["prod_x", "New"]);
	});

	it("PUT reuses the existing Stripe product when interval changes and archives the old price", async () => {
		const products: string[] = [];
		const priced: string[] = [];
		const archived2: string[] = [];
		__setStripeGatewayForTests({
			async createProductWithPrice() { const p = `prod_${products.length}`; products.push(p); return { productId: p, priceId: `price_${priced.push(p)}` }; },
			async createPriceForProduct(i) { priced.push(i.productId); return { priceId: `price_reuse_${priced.length}` }; },
			async updateProductName() {},
			async archivePrice(id) { archived2.push(id); },
			async createCustomer() { return { customerId: "c" }; },
			async createCheckoutSession() { return { url: "u" }; },
			async createPortalSession() { return { url: "u" }; },
			constructWebhookEvent() { return { id: "", type: "", data: { object: {} } }; },
		});
		const created = await (await app.request("/api/v1/admin/billing/plans", { method: "POST", headers: adminHeaders(), body: JSON.stringify({ name: "P", priceCents: 1000, creditsPerPeriod: 500, interval: "month" }) })).json();
		const productCountAfterCreate = products.length;
		const put = await app.request(`/api/v1/admin/billing/plans/${created.id}`, { method: "PUT", headers: adminHeaders(), body: JSON.stringify({ interval: "year" }) });
		const updated = await put.json();
		expect(products.length).toBe(productCountAfterCreate); // NO new product created on interval change
		expect(updated.stripePriceId).not.toBe(created.stripePriceId);
		expect(archived2).toContain(created.stripePriceId);
	});
});
