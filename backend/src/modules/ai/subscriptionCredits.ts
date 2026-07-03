import { and, eq, sql } from "drizzle-orm";
import { db } from "../../db/index";
import { aiCreditLedger } from "../../db/schema";

/**
 * Append-only subscription renewal: roll the closing period's leftover
 * subscription credits into rollover (capped at `rolloverCap`), then grant the
 * new period's subscription credits (expiring at `newPeriodEnd`). Called by the
 * Stripe `invoice.paid` webhook (sub-project B). Returns what was granted/rolled.
 *
 * Leftover is computed period-scoped (by `closingPeriodId`), ignoring expiry —
 * the webhook can fire at/after the closing grant's own expiry, at which point
 * a now()-gated read would see 0. The closing period's grant + its debits share
 * `expiresAt`/`periodId` (see debitBuckets) so no manual "period close" zeroing
 * entry is needed — they net out of the SUM together once expired.
 */
export async function renewSubscriptionPeriod(input: {
	networkId: string;
	creditsPerPeriod: number;
	rolloverCap: number;
	closingPeriodId?: string | null;
	newPeriodId: string;
	newPeriodEnd: Date;
	now?: Date;
}): Promise<{ granted: number; rolledOver: number }> {
	const now = input.now ?? new Date();
	let rolledOver = 0;

	await db.transaction(async (tx) => {
		if (input.closingPeriodId) {
			const [row] = await tx
				.select({ sum: sql<number>`coalesce(sum(${aiCreditLedger.delta}), 0)::int` })
				.from(aiCreditLedger)
				.where(and(
					eq(aiCreditLedger.networkId, input.networkId),
					eq(aiCreditLedger.bucket, "subscription"),
					eq(aiCreditLedger.periodId, input.closingPeriodId),
				));
			const leftover = Math.max(row?.sum ?? 0, 0);
			rolledOver = Math.min(leftover, Math.max(input.rolloverCap, 0));
		}
		// Carry the capped amount into rollover (permanent).
		if (rolledOver > 0) {
			await tx.insert(aiCreditLedger).values({
				id: crypto.randomUUID(), networkId: input.networkId, delta: rolledOver,
				reason: "grant", bucket: "rollover", note: "rollover", createdAt: now,
			});
		}
		// Grant the new period's subscription credits (expiring at period end).
		await tx.insert(aiCreditLedger).values({
			id: crypto.randomUUID(), networkId: input.networkId, delta: input.creditsPerPeriod,
			reason: "grant", bucket: "subscription", expiresAt: input.newPeriodEnd,
			periodId: input.newPeriodId, note: "subscription renewal", createdAt: now,
		});
	});

	return { granted: input.creditsPerPeriod, rolledOver };
}
