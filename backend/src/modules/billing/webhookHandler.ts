import { eq } from "drizzle-orm";
import { db } from "../../db/index";
import { aiCreditLedger, creditPurchases, networkBilling, stripeEvents } from "../../db/schema";
import { creditsForPack, getPack } from "./packsRepo";
import type { StripeWebhookEvent } from "./stripe";

/** Idempotently process a verified Stripe event. Marks the event id processed
 *  FIRST (insert-on-conflict-do-nothing); if already present, returns without
 *  reprocessing. Unknown types are ignored. Throws on handler failure so the
 *  route returns non-2xx and Stripe retries (the event id stays unmarked). */
export async function handleStripeEvent(event: StripeWebhookEvent): Promise<void> {
	// Idempotency: claim the event id. If it already exists, skip.
	const claimed = await db
		.insert(stripeEvents)
		.values({ eventId: event.id, type: event.type, processedAt: new Date() })
		.onConflictDoNothing()
		.returning();
	if (claimed.length === 0) return; // already processed

	try {
		if (event.type === "checkout.session.completed") {
			await onCheckoutCompleted(event.data.object);
		}
		// other types added in T5/T6
	} catch (e) {
		// Undo the idempotency claim so Stripe's retry reprocesses this event.
		await db.delete(stripeEvents).where(eq(stripeEvents.eventId, event.id));
		throw e;
	}
}

async function onCheckoutCompleted(obj: Record<string, unknown>): Promise<void> {
	const md = (obj.metadata ?? {}) as Record<string, string>;
	const networkId = md.networkId;
	if (!networkId) return;

	if (md.kind === "pack") {
		const pack = await getPack(md.packId);
		if (!pack) return;
		const credits = creditsForPack(pack);
		const sessionId = typeof obj.id === "string" ? obj.id : null;
		await db.transaction(async (tx) => {
			await tx.insert(creditPurchases).values({
				id: crypto.randomUUID(),
				networkId,
				packId: pack.id,
				stripeSessionId: sessionId,
				amountCents: typeof obj.amount_total === "number" ? obj.amount_total : pack.priceCents,
				currency: typeof obj.currency === "string" ? obj.currency : pack.currency,
				credits,
				createdBy: md.userId ?? null,
				createdAt: new Date(),
			});
			await tx.insert(aiCreditLedger).values({
				id: crypto.randomUUID(),
				networkId,
				delta: credits,
				reason: "grant",
				bucket: "topup",
				note: "top-up",
				createdBy: md.userId ?? null,
				createdAt: new Date(),
			});
		});
		return;
	}

	if (md.kind === "subscription") {
		const now = new Date();
		const existing = await db.select().from(networkBilling).where(eq(networkBilling.networkId, networkId));
		const patch = {
			stripeCustomerId: typeof obj.customer === "string" ? obj.customer : null,
			stripeSubscriptionId: typeof obj.subscription === "string" ? obj.subscription : null,
			planId: md.planId ?? null,
			updatedAt: now,
		};
		if (existing.length > 0) {
			await db.update(networkBilling).set(patch).where(eq(networkBilling.networkId, networkId));
		} else {
			await db.insert(networkBilling).values({ networkId, ...patch, createdAt: now });
		}
	}
}
