import { afterEach, describe, expect, it } from "bun:test";
import { __setStripeGatewayForTests, getStripeGateway, type StripeGateway } from "./stripe";

afterEach(() => __setStripeGatewayForTests(null));

describe("StripeGateway injection", () => {
	it("getStripeGateway returns the injected fake", () => {
		const fake: StripeGateway = {
			async createProductWithPrice() { return { productId: "prod_x", priceId: "price_x" }; },
			async archivePrice() {},
		};
		__setStripeGatewayForTests(fake);
		expect(getStripeGateway()).toBe(fake);
	});

	it("a fake records calls and returns ids", async () => {
		const calls: unknown[] = [];
		const fake: StripeGateway = {
			async createProductWithPrice(input) { calls.push(input); return { productId: "p1", priceId: "pr1" }; },
			async archivePrice(id) { calls.push({ archive: id }); },
		};
		__setStripeGatewayForTests(fake);
		const g = getStripeGateway();
		const r = await g.createProductWithPrice({ name: "Pack 10", amountCents: 1000, currency: "eur" });
		expect(r).toEqual({ productId: "p1", priceId: "pr1" });
		await g.archivePrice("pr1");
		expect(calls).toEqual([
			{ name: "Pack 10", amountCents: 1000, currency: "eur" },
			{ archive: "pr1" },
		]);
	});
});
