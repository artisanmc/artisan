import { and, eq, gt, isNotNull } from "drizzle-orm";
import { db } from "../../db/index";
import { networkBilling, subscriptionPlans } from "../../db/schema";
import { renewSubscriptionPeriod } from "../ai/subscriptionCredits";

export function annualCreditBoundary(start: Date, monthOffset: number): Date {
  const absoluteMonth = start.getUTCMonth() + monthOffset;
  const year = start.getUTCFullYear() + Math.floor(absoluteMonth / 12);
  const month = absoluteMonth % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(start.getUTCDate(), lastDay), start.getUTCHours(), start.getUTCMinutes(), start.getUTCSeconds(), start.getUTCMilliseconds()));
}

export function annualCreditPeriodId(networkId: string, start: Date, monthIndex: number): string {
  return `${networkId}:annual:${start.toISOString()}:${monthIndex}`;
}

/** Grant only the current monthly allowance when an annual paid cycle crosses a boundary. */
export async function grantDueAnnualProCredits(now = new Date()): Promise<void> {
  const candidates = await db.select({ networkId: networkBilling.networkId }).from(networkBilling).where(and(isNotNull(networkBilling.creditCycleStart), gt(networkBilling.paidThrough, now)));
  for (const { networkId } of candidates) {
    await db.transaction(async (tx) => {
      const [billing] = await tx.select().from(networkBilling).where(eq(networkBilling.networkId, networkId)).for("update");
      if (!billing?.creditCycleStart || billing.creditMonthIndex === null || !billing.paidThrough || billing.paidThrough <= now || billing.creditMonthIndex >= 11 || !billing.planId) return;
      const [plan] = await tx.select().from(subscriptionPlans).where(eq(subscriptionPlans.id, billing.planId));
      if (!plan?.editorPro || plan.interval !== "year") return;

      let monthIndex = billing.creditMonthIndex + 1;
      if (annualCreditBoundary(billing.creditCycleStart, monthIndex) > now) return;
      while (monthIndex < 11 && annualCreditBoundary(billing.creditCycleStart, monthIndex + 1) <= now) monthIndex++;
      const nextBoundary = annualCreditBoundary(billing.creditCycleStart, monthIndex + 1);
      const periodEnd = nextBoundary < billing.paidThrough ? nextBoundary : billing.paidThrough;
      const periodId = annualCreditPeriodId(networkId, billing.creditCycleStart, monthIndex);
      await renewSubscriptionPeriod({ networkId, creditsPerPeriod: plan.creditsPerPeriod, rolloverCap: plan.rolloverCap, closingPeriodId: billing.currentPeriodId, newPeriodId: periodId, newPeriodEnd: periodEnd, now }, tx);
      await tx.update(networkBilling).set({ currentPeriodId: periodId, creditMonthIndex: monthIndex, updatedAt: now }).where(eq(networkBilling.networkId, networkId));
    });
  }
}
