import { and, desc, eq, ne, sql } from "drizzle-orm";
import { db } from "../../db/index";
import { aiCreditLedger } from "../../db/schema";

export type BucketType = "subscription" | "rollover" | "topup";
export const DEBIT_ORDER: BucketType[] = ["subscription", "rollover", "topup"];

export interface BucketBalances {
	subscription: number;
	rollover: number;
	topup: number;
	total: number;
}

export interface LedgerEntry {
	id: string;
	networkId: string;
	delta: number;
	reason: string;
	usageLogId: string | null;
	note: string | null;
	createdBy: string | null;
	createdAt: Date;
}

/** SQL predicate: entry still valid (not expired). */
const notExpired = sql`(${aiCreditLedger.expiresAt} is null or ${aiCreditLedger.expiresAt} > now())`;

export async function getBalance(networkId: string): Promise<number> {
	const rows = await db
		.select({ balance: sql<number>`coalesce(sum(${aiCreditLedger.delta}), 0)::int` })
		.from(aiCreditLedger)
		.where(and(eq(aiCreditLedger.networkId, networkId), notExpired));
	return rows[0]?.balance ?? 0;
}

export async function getBucketBalances(networkId: string): Promise<BucketBalances> {
	const rows = await db
		.select({
			bucket: aiCreditLedger.bucket,
			balance: sql<number>`coalesce(sum(${aiCreditLedger.delta}), 0)::int`,
		})
		.from(aiCreditLedger)
		.where(and(eq(aiCreditLedger.networkId, networkId), notExpired))
		.groupBy(aiCreditLedger.bucket);
	const by: Record<string, number> = {};
	for (const r of rows) by[r.bucket] = r.balance;
	const subscription = by.subscription ?? 0;
	const rollover = by.rollover ?? 0;
	const topup = by.topup ?? 0;
	return { subscription, rollover, topup, total: subscription + rollover + topup };
}

export async function grantCredits(input: {
	networkId: string;
	amount: number;
	note?: string;
	createdBy?: string | null;
	reason?: "grant" | "adjustment";
	bucket?: BucketType;
	expiresAt?: Date | null;
	periodId?: string | null;
}): Promise<{ id: string; balance: number }> {
	const id = crypto.randomUUID();
	await db.insert(aiCreditLedger).values({
		id,
		networkId: input.networkId,
		delta: input.amount,
		reason: input.reason ?? "grant",
		bucket: input.bucket ?? "topup",
		expiresAt: input.expiresAt ?? null,
		periodId: input.periodId ?? null,
		note: input.note ?? null,
		createdBy: input.createdBy ?? null,
		createdAt: new Date(),
	});
	return { id, balance: await getBalance(input.networkId) };
}

export async function listLedger(networkId: string, limit = 50): Promise<LedgerEntry[]> {
	return db
		.select()
		.from(aiCreditLedger)
		.where(eq(aiCreditLedger.networkId, networkId))
		.orderBy(desc(aiCreditLedger.createdAt), desc(aiCreditLedger.id))
		.limit(limit);
}

/** Non-debit ledger entries (grants/refunds/adjustments) — the network's
 *  "purchase history". Filtered in SQL so debit rows can't crowd the window. */
export async function listGrants(networkId: string, limit = 100): Promise<LedgerEntry[]> {
	return db
		.select()
		.from(aiCreditLedger)
		.where(and(eq(aiCreditLedger.networkId, networkId), ne(aiCreditLedger.reason, "debit")))
		.orderBy(desc(aiCreditLedger.createdAt), desc(aiCreditLedger.id))
		.limit(limit);
}
