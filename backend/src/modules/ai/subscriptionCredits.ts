import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../../db/index";
import { aiCreditLedger } from "../../db/schema";

type DbOrTx = typeof db;

/**
 * Append-only subscription renewal: roll the closing period's leftover
 * subscription credits into rollover (capped at `rolloverCap`), then grant the
 * new period's subscription credits (expiring at `newPeriodEnd`). Called by the
 * Stripe `invoice.paid` webhook or the annual Pro monthly grant job. Returns what was granted/rolled.
 *
 * Leftover is computed period-scoped (by `closingPeriodId`), ignoring expiry —
 * the webhook can fire at/after the closing grant's own expiry, at which point
 * a now()-gated read would see 0. A compensating `-leftover` entry is written
 * immediately, tagged with the closing grant's own `expiresAt`, so the closing
 * period nets to 0 both before AND after its grant expires — this closes the
 * `[renewal, expiry)` double-count window that would otherwise let the closing
 * period's unexpired leftover coexist with the new period's grant.
 */
export async function renewSubscriptionPeriod(
	input: {
		networkId: string;
		creditsPerPeriod: number;
		rolloverCap: number;
		closingPeriodId?: string | null;
		newPeriodId: string;
		newPeriodEnd: Date;
		now?: Date;
	},
	existingTx?: DbOrTx,
): Promise<{ granted: number; rolledOver: number }> {
	const now = input.now ?? new Date();

	// All ledger writes run in one transaction. When the caller (the invoice.paid
	// webhook) passes its own tx, we join it so the renewal + the network_billing
	// state update commit atomically; otherwise we open our own.
	const run = async (tx: DbOrTx): Promise<number> => {
		let rolledOver = 0;
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
			// Zero the closing period NOW so the new period doesn't double-count
			// while the closing grant is still non-expired. Tag the compensating
			// entry with the closing period's own expiry so it also nets out of the
			// SUM after expiry (no lingering negative).
			if (leftover > 0) {
				// Invariant: exactly one positive-delta subscription grant per periodId
				// (written here + by the first-period grant). The orderBy is defensive
				// determinism in case a future path ever violates that (e.g. a manual
				// adjustment tagged with the live periodId) — pick the most recent grant.
				const [grant] = await tx
					.select({ expiresAt: aiCreditLedger.expiresAt })
					.from(aiCreditLedger)
					.where(and(
						eq(aiCreditLedger.networkId, input.networkId),
						eq(aiCreditLedger.bucket, "subscription"),
						eq(aiCreditLedger.periodId, input.closingPeriodId),
						sql`${aiCreditLedger.delta} > 0`,
					))
					.orderBy(desc(aiCreditLedger.createdAt))
					.limit(1);
				await tx.insert(aiCreditLedger).values({
					id: crypto.randomUUID(), networkId: input.networkId, delta: -leftover,
					reason: "adjustment", bucket: "subscription", periodId: input.closingPeriodId,
					expiresAt: grant?.expiresAt ?? null, note: "period close", createdAt: now,
				});
			}
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
		return rolledOver;
	};

	const rolledOver = existingTx ? await run(existingTx) : await db.transaction(run);
	return { granted: input.creditsPerPeriod, rolledOver };
}
