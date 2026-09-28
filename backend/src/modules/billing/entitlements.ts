import { eq } from "drizzle-orm";
import { db } from "../../db";
import { networkBilling, subscriptionPlans } from "../../db/schema";
import { STANDARD_CATALOG, type PlanCapabilities, type PlanLimits } from "./catalog";
import { hasManualPlan } from "./manualAssignments";

type Executor = Pick<typeof db, "select">;
export interface NetworkEntitlements {
  planId: string | null;
  planKey: string;
  planName: string;
  limits: PlanLimits;
  capabilities: PlanCapabilities;
  paidThrough: Date | null;
}

export async function resolveNetworkEntitlements(networkId: string, executor: Executor = db, now = new Date()): Promise<NetworkEntitlements> {
  const free = STANDARD_CATALOG[0];
  const fallback: NetworkEntitlements = { planId: null, planKey: free.key, planName: free.name, limits: { ...free.limits }, capabilities: { ...free.capabilities }, paidThrough: null };
  const [billing] = await executor.select().from(networkBilling).where(eq(networkBilling.networkId, networkId));
  if (hasManualPlan(billing, now)) {
    const [manual] = await executor.select().from(subscriptionPlans).where(eq(subscriptionPlans.id, billing.manualPlanId!));
    if (manual?.publicationStatus === "published" && (manual.audience !== "private" || manual.targetNetworkId === networkId)) {
      return { planId: manual.id, planKey: manual.key, planName: manual.name, limits: { ...manual.limits }, capabilities: { ...manual.capabilities }, paidThrough: null };
    }
  }
  if (!billing?.planId || !billing.currentPeriodId || !billing.paidThrough || billing.paidThrough <= now) return fallback;
  const [plan] = await executor.select().from(subscriptionPlans).where(eq(subscriptionPlans.id, billing.planId));
  if (!plan || plan.publicationStatus !== "published" || plan.audience === "private" && plan.targetNetworkId !== networkId) return fallback;
  return { planId: plan.id, planKey: plan.key, planName: plan.name, limits: { ...plan.limits }, capabilities: { ...plan.capabilities }, paidThrough: billing.paidThrough };
}
