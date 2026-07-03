import { afterEach, describe, expect, it } from "bun:test";
import { __setStripeGatewayForTests, getStripeGateway, type StripeGateway } from "./stripe";

afterEach(() => __setStripeGatewayForTests(null));

describe("StripeGateway injection", () => {
	it("getStripeGateway returns the injected fake", () => {
		const fake: StripeGateway = {
			async createProductWithPrice() { return { productId: "prod_x", priceId: "price_x" }; },
			async createPriceForProduct() { return { priceId: "price_y" }; },
			async updateProductName() {},
			async archivePrice() {},
			async createCustomer() { return { customerId: "c" }; },
			async createCheckoutSession() { return { url: "u" }; },
			async createPortalSession() { return { url: "u" }; },
			constructWebhookEvent() { return { id: "", type: "", data: { object: {} } }; },
		};
		__setStripeGatewayForTests(fake);
		expect(getStripeGateway()).toBe(fake);
	});

	it("a fake records calls and returns ids", async () => {
		const calls: unknown[] = [];
		const fake: StripeGateway = {
			async createProductWithPrice(input) { calls.push(input); return { productId: "p1", priceId: "pr1" }; },
			async createPriceForProduct(input) { calls.push({ createPrice: input }); return { priceId: "pr2" }; },
			async updateProductName(id, name) { calls.push({ updateName: [id, name] }); },
			async archivePrice(id) { calls.push({ archive: id }); },
			async createCustomer() { return { customerId: "c" }; },
			async createCheckoutSession() { return { url: "u" }; },
			async createPortalSession() { return { url: "u" }; },
			constructWebhookEvent() { return { id: "", type: "", data: { object: {} } }; },
		};
		__setStripeGatewayForTests(fake);
		const g = getStripeGateway();
		const r = await g.createProductWithPrice({ name: "Pack 10", amountCents: 1000, currency: "eur" });
		expect(r).toEqual({ productId: "p1", priceId: "pr1" });
		await g.createPriceForProduct({ productId: "p1", amountCents: 2000, currency: "eur" });
		await g.updateProductName("p1", "New Name");
		await g.archivePrice("pr1");
		expect(calls).toEqual([
			{ name: "Pack 10", amountCents: 1000, currency: "eur" },
			{ createPrice: { productId: "p1", amountCents: 2000, currency: "eur" } },
			{ updateName: ["p1", "New Name"] },
			{ archive: "pr1" },
		]);
	});
});

describe("StripeGateway checkout/portal (fake records calls)", () => {
	it("a fake exposes customer/checkout/portal and records inputs", async () => {
		const calls: Record<string, unknown> = {};
		const fake: StripeGateway = {
			async createProductWithPrice() { return { productId: "prod", priceId: "price" }; },
			async createPriceForProduct() { return { priceId: "price" }; },
			async updateProductName() {},
			async archivePrice() {},
			async createCustomer(i) { calls.customer = i; return { customerId: "cus_1" }; },
			async createCheckoutSession(i) { calls.checkout = i; return { url: "https://checkout.test/s" }; },
			async createPortalSession(i) { calls.portal = i; return { url: "https://portal.test/s" }; },
			constructWebhookEvent() { return { id: "", type: "", data: { object: {} } }; },
		};
		__setStripeGatewayForTests(fake);
		const g = getStripeGateway();
		expect(await g.createCustomer({ metadata: { networkId: "n1" } })).toEqual({ customerId: "cus_1" });
		const co = await g.createCheckoutSession({ mode: "payment", priceId: "price", customerId: "cus_1", successUrl: "s", cancelUrl: "c", metadata: { kind: "pack" } });
		expect(co.url).toBe("https://checkout.test/s");
		const po = await g.createPortalSession({ customerId: "cus_1", returnUrl: "r" });
		expect(po.url).toBe("https://portal.test/s");
		expect((calls.checkout as { mode: string }).mode).toBe("payment");
	});

	it("a fake constructWebhookEvent returns the injected event", () => {
		const ev = { id: "evt_1", type: "checkout.session.completed", data: { object: { foo: "bar" } } };
		const fake: StripeGateway = {
			async createProductWithPrice() { return { productId: "p", priceId: "pr" }; },
			async createPriceForProduct() { return { priceId: "pr2" }; },
			async updateProductName() {},
			async archivePrice() {},
			async createCustomer() { return { customerId: "c" }; },
			async createCheckoutSession() { return { url: "u" }; },
			async createPortalSession() { return { url: "u" }; },
			constructWebhookEvent() { return ev; },
		};
		__setStripeGatewayForTests(fake);
		expect(getStripeGateway().constructWebhookEvent("raw", "sig")).toBe(ev);
	});
});
