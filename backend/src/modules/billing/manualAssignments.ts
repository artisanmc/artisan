import { eq, isNotNull } from "drizzle-orm";
import { db } from "../../db";
import { billingConfigAudit, networkBilling, networks, subscriptionPlans } from "../../db/schema";
import { renewSubscriptionPeriod } from "../ai/subscriptionCredits";
import { annualCreditBoundary } from "./annualProCredits";
import type { NetworkBillingRow } from "./networkBillingRepo";

export function hasManualPlan(billing: NetworkBillingRow | null | undefined, now = new Date()): boolean {
  return !!billing?.manualPlanId && !!billing.manualStartedAt && (!billing.manualExpiresAt || billing.manualExpiresAt > now);
}

const clearedAssignment = {
  manualPlanId: null, manualStartedAt: null, manualExpiresAt: null,
  manualPeriodId: null, manualPeriodIndex: null, manualPeriodEnd: null,
};

// Caller holds the network_billing row lock, also used by invoice fulfillment.
export async function clearManualAssignment(tx: typeof db, billing: NetworkBillingRow, now: Date) {
  if (!billing.manualPlanId) return;
  if (billing.manualPeriodId) {
    await renewSubscriptionPeriod({ networkId: billing.networkId, creditsPerPeriod: 0, rolloverCap: 0,
      closingPeriodId: billing.manualPeriodId, newPeriodId: `manual:closed:${crypto.randomUUID()}`, newPeriodEnd: now, now }, tx);
  }
  await tx.update(networkBilling).set({ ...clearedAssignment, updatedAt: now }).where(eq(networkBilling.networkId, billing.networkId));
}

export async function assignManualPlan(networkId: string, planId: string | null, expiresAt: Date | null, actorId: string, now = new Date()) {
  if (expiresAt && (!Number.isFinite(expiresAt.getTime()) || expiresAt <= now)) throw new Error("invalid_expiration");
  await db.transaction(async tx => {
    const [network] = await tx.select({ id: networks.id }).from(networks).where(eq(networks.id, networkId));
    if (!network) throw new Error("network_not_found");
    await tx.insert(networkBilling).values({ networkId, createdAt: now, updatedAt: now }).onConflictDoNothing();
    const [billing] = await tx.select().from(networkBilling).where(eq(networkBilling.networkId, networkId)).for("update");
    const [plan] = planId ? await tx.select().from(subscriptionPlans).where(eq(subscriptionPlans.id, planId)).for("share") : [];
    if (planId && (!plan || !plan.isActive || plan.publicationStatus !== "published" || plan.audience === "private" && plan.targetNetworkId !== networkId)) throw new Error("plan_not_available");
    const selected = plan?.key === "free" ? null : plan;
    if (selected && (billing.paidThrough && billing.paidThrough > now || billing.stripeSubscriptionId && !["canceled", "incomplete_expired"].includes(billing.status ?? ""))) throw new Error("subscription_exists");
    if (hasManualPlan(billing, now) && billing.manualPlanId === selected?.id && billing.manualExpiresAt?.getTime() === expiresAt?.getTime()) return;
    if (!billing.manualPlanId && !selected) return;
    await clearManualAssignment(tx, billing, now);
    if (selected) {
      const boundary = annualCreditBoundary(now, selected.creditInterval === "year" ? 12 : 1);
      const periodEnd = expiresAt && expiresAt < boundary ? expiresAt : boundary;
      const periodId = `manual:${networkId}:${crypto.randomUUID()}:0`;
      if (selected.creditInterval !== "none") {
        await renewSubscriptionPeriod({ networkId, creditsPerPeriod: selected.creditsPerPeriod, rolloverCap: 0,
          newPeriodId: periodId, newPeriodEnd: periodEnd, now }, tx);
      }
      await tx.update(networkBilling).set({ manualPlanId: selected.id, manualStartedAt: now, manualExpiresAt: expiresAt,
        manualPeriodId: selected.creditInterval === "none" ? null : periodId, manualPeriodIndex: 0,
        manualPeriodEnd: selected.creditInterval === "none" ? null : periodEnd, updatedAt: now }).where(eq(networkBilling.networkId, networkId));
    }
    await tx.insert(billingConfigAudit).values({ id: crypto.randomUUID(), actorId, action: selected ? "plan_assign" : "plan_revoke",
      before: { networkId, planId: billing.manualPlanId, expiresAt: billing.manualExpiresAt },
      after: { networkId, planId: selected?.id ?? null, expiresAt: selected ? expiresAt : null }, createdAt: now });
  });
}

export async function grantDueManualPlanCredits(now = new Date()) {
  const candidates = await db.select({ networkId: networkBilling.networkId }).from(networkBilling).where(isNotNull(networkBilling.manualPlanId));
  for (const { networkId } of candidates) {
    await db.transaction(async tx => {
      const [billing] = await tx.select().from(networkBilling).where(eq(networkBilling.networkId, networkId)).for("update");
      if (!billing?.manualPlanId) return;
      if (!hasManualPlan(billing, now)) {
        await clearManualAssignment(tx, billing, now);
        return;
      }
      const [plan] = await tx.select().from(subscriptionPlans).where(eq(subscriptionPlans.id, billing.manualPlanId));
      if (!plan || plan.creditInterval === "none" || !billing.manualPeriodEnd || billing.manualPeriodEnd > now) return;
      const anchor = billing.manualStartedAt!;
      const step = plan.creditInterval === "year" ? 12 : 1;
      let index = Math.floor(((now.getUTCFullYear() - anchor.getUTCFullYear()) * 12 + now.getUTCMonth() - anchor.getUTCMonth()) / step);
      if (annualCreditBoundary(anchor, index * step) > now) index--;
      if (index <= (billing.manualPeriodIndex ?? 0)) return;
      const boundary = annualCreditBoundary(anchor, (index + 1) * step);
      const end = billing.manualExpiresAt && billing.manualExpiresAt < boundary ? billing.manualExpiresAt : boundary;
      const periodId = `manual:${networkId}:${anchor.toISOString()}:${index}`;
      await renewSubscriptionPeriod({ networkId, creditsPerPeriod: plan.creditsPerPeriod,
        rolloverCap: index === (billing.manualPeriodIndex ?? 0) + 1 ? plan.rolloverCap : 0,
        closingPeriodId: billing.manualPeriodId, newPeriodId: periodId, newPeriodEnd: end, now }, tx);
      await tx.update(networkBilling).set({ manualPeriodId: periodId, manualPeriodIndex: index, manualPeriodEnd: end, updatedAt: now }).where(eq(networkBilling.networkId, networkId));
    });
  }
}
