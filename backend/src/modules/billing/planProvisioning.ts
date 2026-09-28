import { eq, sql } from "drizzle-orm";
import { db } from "../../db/index";
import { subscriptionPlans } from "../../db/schema";
import { listCurrentPlans } from "./plansRepo";
import { getStripeGateway, isStripeConfigured } from "./stripe";
export type ProvisionResult = {
    planId: string;
    status: "ready" | "unavailable" | "error";
    error?: string;
};
export async function provisionPublishedPlans(): Promise<ProvisionResult[]> {
    const candidates = (await listCurrentPlans()).filter(p => p.isActive && p.priceCents > 0);
    const results: ProvisionResult[] = [];
    for (const candidate of candidates) {
        if (!isStripeConfigured()) {
            results.push({ planId: candidate.id, status: "unavailable" });
            continue;
        }
        const result = await db.transaction(async (tx): Promise<ProvisionResult> => {
            await tx.execute(sql `select pg_advisory_xact_lock(hashtextextended(${candidate.id}, 82416))`);
            const [plan] = await tx.select().from(subscriptionPlans).where(eq(subscriptionPlans.id, candidate.id));
            if (!plan || !plan.isActive || plan.publicationStatus !== "published" || plan.audience === "private" && !plan.targetNetworkId)
                return { planId: candidate.id, status: "unavailable" };
            if (plan.stripePriceId)
                return { planId: plan.id, status: "ready" };
            try {
                const gateway = getStripeGateway();
                if (!gateway.ensurePlanProduct || !gateway.ensurePlanPrice)
                    throw new Error("plan_provisioning_not_supported");
                let productId = plan.stripeProductId;
                if (!productId) {
                    productId = (await gateway.ensurePlanProduct({ planId: plan.id, name: plan.name })).productId;
                    await tx.update(subscriptionPlans).set({ stripeProductId: productId, updatedAt: new Date() }).where(eq(subscriptionPlans.id, plan.id));
                }
                const { priceId } = await gateway.ensurePlanPrice({ planId: plan.id, productId, amountCents: plan.priceCents, currency: plan.currency, interval: plan.interval as "month" | "year" });
                await tx.update(subscriptionPlans).set({ stripePriceId: priceId, updatedAt: new Date() }).where(eq(subscriptionPlans.id, plan.id));
                return { planId: plan.id, status: "ready" };
            }
            catch (error) {
                return { planId: plan.id, status: "error", error: error instanceof Error ? error.message : "provisioning_failed" };
            }
        });
        results.push(result);
    }
    return results;
}
