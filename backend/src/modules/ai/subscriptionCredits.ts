import { db } from "../../db/index";
import { aiCreditLedger } from "../../db/schema";
import { getBucketBalances } from "./creditsRepo";

/**
 * Append-only subscription renewal: roll the leftover of the closing period's
 * subscription bucket into rollover (capped at `rolloverCap`), then grant the
 * new period's subscription credits (expiring at `newPeriodEnd`). Called by the
 * Stripe `invoice.paid` webhook (sub-project B). Returns what was granted/rolled.
 */
export async function renewSubscriptionPeriod(input: {
	networkId: string;
	creditsPerPeriod: number;
	rolloverCap: number;
	newPeriodId: string;
	newPeriodEnd: Date;
	now?: Date;
}): Promise<{ granted: number; rolledOver: number }> {
	const now = input.now ?? new Date();
	const before = await getBucketBalances(input.networkId);
	const leftover = Math.max(before.subscription, 0);
	const rolledOver = Math.min(leftover, Math.max(input.rolloverCap, 0));

	await db.transaction(async (tx) => {
		// Zero the closing period's subscription bucket (append a matching negative).
		if (leftover > 0) {
			await tx.insert(aiCreditLedger).values({
				id: crypto.randomUUID(), networkId: input.networkId, delta: -leftover,
				reason: "adjustment", bucket: "subscription", note: "period close",
				createdAt: now,
			});
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
