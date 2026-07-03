import { desc, eq } from "drizzle-orm";
import { db } from "../../db/index";
import { creditPurchases } from "../../db/schema";

export type Purchase = typeof creditPurchases.$inferSelect;

export async function listPurchases(networkId: string, limit = 50): Promise<Purchase[]> {
	return db
		.select()
		.from(creditPurchases)
		.where(eq(creditPurchases.networkId, networkId))
		.orderBy(desc(creditPurchases.createdAt), desc(creditPurchases.id))
		.limit(limit);
}
