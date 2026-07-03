import { and, eq } from "drizzle-orm";
import { db } from "../../db/index";
import { memberships, networkBilling } from "../../db/schema";
import { getStripeGateway } from "./stripe";

export type NetworkBillingRow = typeof networkBilling.$inferSelect;

export async function getNetworkBilling(networkId: string): Promise<NetworkBillingRow | null> {
	const rows = await db.select().from(networkBilling).where(eq(networkBilling.networkId, networkId));
	return rows[0] ?? null;
}

export async function isMember(userId: string, networkId: string): Promise<boolean> {
	const rows = await db
		.select({ id: memberships.id })
		.from(memberships)
		.where(and(eq(memberships.userId, userId), eq(memberships.networkId, networkId)));
	return rows.length > 0;
}

/** Return the network's Stripe customer id, creating+persisting it if absent. */
export async function ensureCustomer(networkId: string, email?: string): Promise<string> {
	const existing = await getNetworkBilling(networkId);
	if (existing?.stripeCustomerId) return existing.stripeCustomerId;
	const { customerId } = await getStripeGateway().createCustomer({ metadata: { networkId }, email });
	const now = new Date();
	if (existing) {
		await db
			.update(networkBilling)
			.set({ stripeCustomerId: customerId, updatedAt: now })
			.where(eq(networkBilling.networkId, networkId));
	} else {
		await db.insert(networkBilling).values({ networkId, stripeCustomerId: customerId, createdAt: now, updatedAt: now });
	}
	return customerId;
}
