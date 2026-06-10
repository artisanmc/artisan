import { eq } from "drizzle-orm";
import { db } from "../db/index";
import { networks } from "../db/schema";
import { allocNetworkSlug } from "./slugAlloc";

export type Network = typeof networks.$inferSelect;

export async function createNetwork(name: string): Promise<Network> {
	const id = "net_" + crypto.randomUUID().replace(/-/g, "").slice(0, 12);
	const slug = await allocNetworkSlug(name);
	const now = new Date();
	await db.insert(networks).values({
		id,
		name,
		slug,
		tier: "free",
		subscriptionId: null,
		createdAt: now,
		updatedAt: now,
	});
	const rows = await db.select().from(networks).where(eq(networks.id, id));
	return rows[0]!;
}

export async function getNetworkById(id: string): Promise<Network | null> {
	const rows = await db.select().from(networks).where(eq(networks.id, id));
	return rows[0] ?? null;
}
