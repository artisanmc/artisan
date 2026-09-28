import { afterEach, expect, it } from "bun:test";
import { syncStandardPlans } from "./catalog";
import { listCurrentPlans } from "./plansRepo";
import { __setStripeGatewayForTests, type StripeGateway } from "./stripe";
import { provisionPublishedPlans } from "./planProvisioning";
import { db } from "../../db/index";
import { subscriptionPlans } from "../../db/schema";
afterEach(() => __setStripeGatewayForTests(null));
it("recovers partial provisioning and is idempotent across workers", async () => {
    await syncStandardPlans();
    await db.update(subscriptionPlans).set({ stripeProductId: null, stripePriceId: null });
    const products = new Set<string>(), prices = new Map<string, string>();
    let fail = true, productCalls = 0;
    __setStripeGatewayForTests({
        async ensurePlanProduct(i: any) { productCalls++; products.add(i.planId); return { productId: `prod_${i.planId}` }; },
        async ensurePlanPrice(i: any) { if (fail) {
            fail = false;
            throw new Error("temporary price failure");
        } const id = prices.get(i.planId) ?? `price_${i.planId}`; prices.set(i.planId, id); return { priceId: id }; },
    } as unknown as StripeGateway);
    const first = await provisionPublishedPlans();
    expect(first.some(r => r.status === "error")).toBe(true);
    await Promise.all([provisionPublishedPlans(), provisionPublishedPlans()]);
    const plans = (await listCurrentPlans()).filter(p => p.priceCents > 0);
    expect(plans.every(p => p.stripePriceId && p.stripeProductId)).toBe(true);
    expect(products.size).toBe(plans.length);
    expect(prices.size).toBe(plans.length);
    expect(productCalls).toBe(plans.length);
    expect((await provisionPublishedPlans()).every(r => r.status === "ready")).toBe(true);
});
