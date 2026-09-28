import { expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../../db/index";
import { networkBilling, subscriptionPlans } from "../../db/schema";
import { createNetwork } from "../../lib/networkManager";
import { handleStripeEvent } from "./webhookHandler";
import { grantDueAnnualProCredits } from "./annualProCredits";
import { getBucketBalances } from "../ai/creditsRepo";
import { __setStripeGatewayForTests, type StripeGateway } from "./stripe";
it("orders paid same-period changes and resolves tied timestamps without reverting rights", async () => {
    const networkId = (await createNetwork("invoice-order-test")).id;
    const id = crypto.randomUUID(), next = crypto.randomUUID(), final = crypto.randomUUID(), now = new Date();
    const base = { name: "Contract", key: `custom:${id}`, interval: "year", priceCents: 9000, currency: "eur", publicationStatus: "published", audience: "private", targetNetworkId: networkId, creditsPerPeriod: 100, creditInterval: "month", createdAt: now, updatedAt: now };
    await db.insert(subscriptionPlans).values([
        { ...base, id, version: 1, stripePriceId: `price_${id}` },
        { ...base, id: next, version: 2, stripePriceId: `price_${next}` },
        { ...base, id: final, version: 3, stripePriceId: `price_${final}`, creditInterval: "year" }
    ]);
    const sub = `sub_${id}`, start = new Date("2999-01-01"), end = new Date("3000-01-01");
    await db.insert(networkBilling).values({ networkId, planId: id, stripeSubscriptionId: sub, createdAt: now, updatedAt: now });
    const invoice = (invoiceId: string, planId: string, created: number) => handleStripeEvent({ id: crypto.randomUUID(), type: "invoice.paid", data: { object: { id: invoiceId, created, subscription: sub, billing_reason: "subscription_update", lines: { data: [{ price: { id: `price_${planId}` }, period: { start: start.getTime()/1000, end: end.getTime()/1000 } }] } } } });
    await invoice("initial", id, 100);
    await invoice("upgrade", next, 200);
    await invoice("latest", final, 300);
    await invoice("upgrade", next, 200);
    await invoice("late-never-seen", id, 150);
    let row = (await db.select().from(networkBilling).where(eq(networkBilling.networkId, networkId)))[0];
    expect(row.planId).toBe(final);
    expect(row.creditCycleStart).toBeNull();
    expect(row.creditMonthIndex).toBeNull();
    __setStripeGatewayForTests({async getSubscriptionPaymentState(){return {invoiceId:"ambiguous",priceId:`price_${next}`,paid:true};}} as unknown as StripeGateway);
    try {
        await invoice("ambiguous", next, 300);
        await invoice("latest", final, 300);
        row = (await db.select().from(networkBilling).where(eq(networkBilling.networkId, networkId)))[0];
        expect(row.planId).toBe(next);
    } finally { __setStripeGatewayForTests(null); }
});
it("uses exact paid Price version, preserves it on unpaid updates, and grants custom monthly credits", async () => {
    const networkId = (await createNetwork("price-version-test")).id, id = crypto.randomUUID(), second = crypto.randomUUID(), now = new Date();
    const base = { name: "Custom", key: `custom:${id}`, interval: "year" as const, priceCents: 8000, currency: "eur", creditsPerPeriod: 125, creditInterval: "month" as const, editorPro: false, capabilities: { editorPro: false }, publicationStatus: "published" as const, audience: "private" as const, targetNetworkId: networkId, stripeProductId: `prod_${id}`, createdAt: now, updatedAt: now };
    await db.insert(subscriptionPlans).values([{ ...base, id, stripePriceId: `price_${id}`, version: 1 }, { ...base, id: second, stripePriceId: `price_${second}`, creditsPerPeriod: 999, version: 2 }]);
    const sub = `sub_${id}`, start = new Date("2999-01-31"), end = new Date("3000-01-31");
    await db.insert(networkBilling).values({ networkId, planId: id, stripeSubscriptionId: sub, createdAt: now, updatedAt: now });
    let created = 1_800_000_000;
    const send = (type: string, object: Record<string, unknown>) => handleStripeEvent({ id: crypto.randomUUID(), type, data: { object: {created:++created,...object} } });
    await send("invoice.paid", { id: `inv_${id}`, subscription: sub, billing_reason: "subscription_create", lines: { data: [{ price: { id: `price_${id}`, product: base.stripeProductId }, period: { start: start.getTime() / 1000, end: end.getTime() / 1000 } }] } });
    expect((await getBucketBalances(networkId)).subscription).toBe(125);
    const unmapped = await send("invoice.paid", { id: `unmapped_${id}`, subscription: sub, lines: { data: [{ price: { product: base.stripeProductId }, period: { end: end.getTime() / 1000 } }] } }).then(() => null, e => e.message);
    expect(unmapped).toContain("plan mapping unavailable");
    await send("customer.subscription.updated", { id: sub, status: "active", items: { data: [{ price: { id: `price_${second}`, product: base.stripeProductId } }] } });
    const [billing] = await db.select().from(networkBilling).where(eq(networkBilling.networkId, networkId));
    expect(billing.planId).toBe(id);
    expect(billing.creditMonthIndex).toBe(0);
    await grantDueAnnualProCredits(new Date("2999-02-28"));
    expect((await db.select().from(networkBilling).where(eq(networkBilling.networkId, networkId)))[0].creditMonthIndex).toBe(1);
    expect((await getBucketBalances(networkId)).subscription).toBe(125);
    const nextEnd = new Date("3001-01-31");
    await send("invoice.paid", { id: `renew_${id}`, parent: { subscription_details: { subscription: sub } }, billing_reason: "subscription_cycle", lines: { data: [{ amount: -1, pricing: { price_details: { price: `price_${second}` } }, period: { start: end.getTime() / 1000, end: nextEnd.getTime() / 1000 } }, { amount: 8000, pricing: { price_details: { price: `price_${id}` } }, period: { start: end.getTime() / 1000, end: nextEnd.getTime() / 1000 } }] } });
    expect((await getBucketBalances(networkId)).subscription).toBe(125);
    const foreign = (await createNetwork("foreign-price-test")).id;
    await db.insert(networkBilling).values({ networkId: foreign, planId: id, stripeSubscriptionId: `foreign_${sub}`, createdAt: now, updatedAt: now });
    const error = await send("invoice.paid", { id: `foreign_inv_${id}`, subscription: `foreign_${sub}`, billing_reason: "subscription_create", lines: { data: [{ price: { id: `price_${id}` }, period: { start: start.getTime() / 1000, end: end.getTime() / 1000 } }] } }).then(() => null, e => e.message);
    expect(error).toBe("plan_network_mismatch");
    expect((await getBucketBalances(foreign)).subscription).toBe(0);
});
