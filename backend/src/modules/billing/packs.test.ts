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
	await db.delete(creditPacks);
	archived = [];
});

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
		const oldPriceId = created.stripePriceId;
		const put = await app.request(`/api/v1/admin/billing/packs/${created.id}`, {
			method: "PUT", headers: adminHeaders(),
			body: JSON.stringify({ priceCents: 2000 }),
		});
		expect(put.status).toBe(200);
		const updated = await put.json();
		expect(updated.priceCents).toBe(2000);
		expect(updated.stripePriceId).not.toBe(oldPriceId); // new price provisioned
		expect(archived).toContain(oldPriceId); // old price archived
	});

	it("PUT re-provisions when only the currency changes", async () => {
		const created = await (await app.request("/api/v1/admin/billing/packs", {
			method: "POST", headers: adminHeaders(),
			body: JSON.stringify({ name: "P", priceCents: 1000, credits: 500, currency: "eur" }),
		})).json();
		const oldPriceId = created.stripePriceId;
		expect(created.currency).toBe("eur");
		const put = await app.request(`/api/v1/admin/billing/packs/${created.id}`, {
			method: "PUT", headers: adminHeaders(),
			body: JSON.stringify({ currency: "usd" }),
		});
		expect(put.status).toBe(200);
		const updated = await put.json();
		expect(updated.currency).toBe("usd");
		expect(updated.stripePriceId).not.toBe(oldPriceId); // new price provisioned
		expect(archived).toContain(oldPriceId); // old price archived
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

	it("GET /packs/:id returns the pack; 404 for unknown", async () => {
		const created = await (await app.request("/api/v1/admin/billing/packs", {
			method: "POST", headers: adminHeaders(),
			body: JSON.stringify({ name: "P", priceCents: 1000, credits: 500 }),
		})).json();
		const got = await app.request(`/api/v1/admin/billing/packs/${created.id}`, { headers: adminHeaders() });
		expect(got.status).toBe(200);
		expect((await got.json()).id).toBe(created.id);
		const missing = await app.request("/api/v1/admin/billing/packs/nope", { headers: adminHeaders() });
		expect(missing.status).toBe(404);
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
		const created = await (await app.request("/api/v1/admin/billing/packs", { method: "POST", headers: adminHeaders(), body: JSON.stringify({ name: "P", priceCents: 1000, credits: 500 }) })).json();
		const productCountAfterCreate = products.length;
		const put = await app.request(`/api/v1/admin/billing/packs/${created.id}`, { method: "PUT", headers: adminHeaders(), body: JSON.stringify({ priceCents: 2000 }) });
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
		const created = await (await app.request("/api/v1/admin/billing/packs", { method: "POST", headers: adminHeaders(), body: JSON.stringify({ name: "Old", priceCents: 1000, credits: 500 }) })).json();
		await app.request(`/api/v1/admin/billing/packs/${created.id}`, { method: "PUT", headers: adminHeaders(), body: JSON.stringify({ name: "New" }) });
		expect(renamed).toContainEqual(["prod_x", "New"]);
	});
});
