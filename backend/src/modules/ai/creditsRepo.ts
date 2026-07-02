import { desc, eq, sql } from "drizzle-orm";
import { db } from "../../db/index";
import { aiCreditLedger } from "../../db/schema";

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

export async function getBalance(networkId: string): Promise<number> {
	const rows = await db
		.select({ balance: sql<number>`coalesce(sum(${aiCreditLedger.delta}), 0)::int` })
		.from(aiCreditLedger)
		.where(eq(aiCreditLedger.networkId, networkId));
	return rows[0]?.balance ?? 0;
}

export async function grantCredits(input: {
	networkId: string;
	amount: number;
	note?: string;
	createdBy?: string | null;
	reason?: "grant" | "adjustment";
}): Promise<{ id: string; balance: number }> {
	const id = crypto.randomUUID();
	await db.insert(aiCreditLedger).values({
		id,
		networkId: input.networkId,
		delta: input.amount,
		reason: input.reason ?? "grant",
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
