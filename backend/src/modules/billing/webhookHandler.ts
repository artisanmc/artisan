import { eq } from "drizzle-orm";
import { db } from "../../db/index";
import { aiCreditLedger, creditPurchases, networkBilling, networks, stripeEvents } from "../../db/schema";
import { grantCredits } from "../ai/creditsRepo";
import { renewSubscriptionPeriod } from "../ai/subscriptionCredits";
import { getNetworkBilling } from "./networkBillingRepo";
import { creditsForPack, getPack } from "./packsRepo";
import { getPlan } from "./plansRepo";
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
		} else if (event.type === "invoice.paid") {
			await onInvoicePaid(event.data.object);
		} else if (event.type === "invoice.payment_failed") {
			await onPaymentFailed(event.data.object);
		} else if (event.type === "customer.subscription.updated") {
			await onSubscriptionUpdated(event.data.object);
		} else if (event.type === "customer.subscription.deleted") {
			await onSubscriptionDeleted(event.data.object);
		}
	} catch (e) {
		console.error(`[billing/webhook] handler failed for event ${event.id} (${event.type}); undoing claim so Stripe retries`, e);
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
		if (!pack) {
			// Customer paid but the pack is gone — surface it for post-mortem; the
			// event stays claimed (retry can't recover a deleted pack).
			console.error(`[billing/webhook] checkout.session.completed: pack ${md.packId} not found for paid session ${String(obj.id)} (network ${networkId}) — credits NOT granted`);
			return;
		}
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

async function onInvoicePaid(obj: Record<string, unknown>): Promise<void> {
	const subscriptionId = typeof obj.subscription === "string" ? obj.subscription : null;
	const md = (obj.metadata ?? {}) as Record<string, string>;
	// Resolve network: prefer metadata.networkId, else our stored subscription mapping.
	let billing: Awaited<ReturnType<typeof getNetworkBilling>> = null;
	let networkId = md.networkId ?? "";
	if (networkId) billing = await getNetworkBilling(networkId);
	if (!billing && subscriptionId) {
		const rows = await db.select().from(networkBilling).where(eq(networkBilling.stripeSubscriptionId, subscriptionId));
		billing = rows[0] ?? null;
		networkId = billing?.networkId ?? "";
	}
	if (!billing || !networkId || !billing.planId) return;
	const plan = await getPlan(billing.planId);
	if (!plan) return;

	const lines = (obj.lines as { data?: Array<{ period?: { end?: number } }> } | undefined)?.data ?? [];
	const endUnix = lines[0]?.period?.end;
	// A real invoice.paid always carries lines[].period.end (unix seconds) + an id.
	// Fail loud (the claim is undone → Stripe retries) rather than silently granting
	// a now()-expiry grant (charged, but expires instantly) or a random period id.
	if (typeof endUnix !== "number" || typeof obj.id !== "string") {
		throw new Error(`invoice.paid missing period end or id (invoice ${String(obj.id)})`);
	}
	const periodEnd = new Date(endUnix * 1000);
	const newPeriodId = obj.id;
	const isFirst = obj.billing_reason === "subscription_create";

	if (isFirst) {
		await grantCredits({ networkId, amount: plan.creditsPerPeriod, bucket: "subscription", expiresAt: periodEnd, periodId: newPeriodId, reason: "grant", note: "subscription" });
	} else {
		await renewSubscriptionPeriod({ networkId, creditsPerPeriod: plan.creditsPerPeriod, rolloverCap: plan.rolloverCap, closingPeriodId: billing.currentPeriodId ?? null, newPeriodId, newPeriodEnd: periodEnd });
	}
	await db.update(networkBilling).set({
		status: "active", currentPeriodEnd: periodEnd, currentPeriodId: newPeriodId, graceUntil: null, updatedAt: new Date(),
	}).where(eq(networkBilling.networkId, networkId));
	await db.update(networks).set({ tier: plan.name, updatedAt: new Date() }).where(eq(networks.id, networkId));
}

/** Resolve network_billing by Stripe subscription id (the lifecycle events below carry
 *  the subscription id directly, not our metadata). Returns null if id absent/unknown. */
async function billingBySubscription(subscriptionId: string | null) {
	if (!subscriptionId) return null;
	const rows = await db.select().from(networkBilling).where(eq(networkBilling.stripeSubscriptionId, subscriptionId));
	return rows[0] ?? null;
}

async function onPaymentFailed(obj: Record<string, unknown>): Promise<void> {
	const b = await billingBySubscription(typeof obj.subscription === "string" ? obj.subscription : null);
	if (!b) return;
	const graceDays = Number(process.env.BILLING_GRACE_DAYS ?? 7);
	const graceUntil = new Date(Date.now() + graceDays * 24 * 3600 * 1000);
	await db.update(networkBilling).set({ status: "past_due", graceUntil, updatedAt: new Date() }).where(eq(networkBilling.networkId, b.networkId));
}

const STATUS_MAP: Record<string, string> = { active: "active", past_due: "past_due", canceled: "canceled", unpaid: "canceled", trialing: "active" };

async function onSubscriptionUpdated(obj: Record<string, unknown>): Promise<void> {
	const b = await billingBySubscription(typeof obj.id === "string" ? obj.id : null);
	if (!b) return;
	const status = STATUS_MAP[String(obj.status)] ?? b.status ?? "active";
	const end = typeof obj.current_period_end === "number" ? new Date(obj.current_period_end * 1000) : b.currentPeriodEnd;
	await db.update(networkBilling).set({ status, currentPeriodEnd: end, updatedAt: new Date() }).where(eq(networkBilling.networkId, b.networkId));
}

async function onSubscriptionDeleted(obj: Record<string, unknown>): Promise<void> {
	const b = await billingBySubscription(typeof obj.id === "string" ? obj.id : null);
	if (!b) return;
	await db.update(networkBilling).set({ status: "canceled", updatedAt: new Date() }).where(eq(networkBilling.networkId, b.networkId));
	await db.update(networks).set({ tier: "free", updatedAt: new Date() }).where(eq(networks.id, b.networkId));
}
