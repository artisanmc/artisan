import { eq } from "drizzle-orm";
import { db } from "../../db/index";
import { subscriptionPlans } from "../../db/schema";
import { getStripeGateway } from "./stripe";

export interface SubscriptionPlan {
	id: string;
	name: string;
	interval: string;
	priceCents: number;
	currency: string;
	creditsPerPeriod: number;
	rolloverCap: number;
	features: string;
	description: string;
	highlighted: boolean;
	editorPro: boolean;
	isActive: boolean;
	sortOrder: number;
	stripeProductId: string | null;
	stripePriceId: string | null;
	createdAt: Date;
	updatedAt: Date;
}
export type PlanInput = {
	name: string;
	interval?: "month" | "year";
	priceCents: number;
	currency?: string;
	creditsPerPeriod: number;
	rolloverCap?: number;
	features?: string;
	description?: string;
	highlighted?: boolean;
	editorPro?: boolean;
	isActive?: boolean;
	sortOrder?: number;
};

export async function listPlans(): Promise<SubscriptionPlan[]> {
	return db.select().from(subscriptionPlans).orderBy(subscriptionPlans.sortOrder, subscriptionPlans.id);
}
export async function getPlan(id: string): Promise<SubscriptionPlan | null> {
	const rows = await db.select().from(subscriptionPlans).where(eq(subscriptionPlans.id, id));
	return rows[0] ?? null;
}

export async function createPlan(input: PlanInput): Promise<SubscriptionPlan> {
	const currency = input.currency ?? "eur";
	const interval = input.interval ?? "month";
	const { productId, priceId } = await getStripeGateway().createProductWithPrice({
		name: input.name,
		amountCents: input.priceCents,
		currency,
		recurring: { interval },
	});
	const now = new Date();
	const row = {
		id: crypto.randomUUID(),
		name: input.name,
		interval,
		priceCents: input.priceCents,
		currency,
		creditsPerPeriod: input.creditsPerPeriod,
		rolloverCap: input.rolloverCap ?? 0,
		features: input.features ?? "",
		description: input.description ?? "",
		highlighted: input.highlighted ?? false,
		editorPro: input.editorPro ?? false,
		isActive: input.isActive ?? true,
		sortOrder: input.sortOrder ?? 0,
		stripeProductId: productId,
		stripePriceId: priceId,
		createdAt: now,
		updatedAt: now,
	};
	await db.insert(subscriptionPlans).values(row);
	return row;
}

export async function updatePlan(id: string, patch: Partial<PlanInput>): Promise<SubscriptionPlan | null> {
	const existing = await getPlan(id);
	if (!existing) return null;
	const next: Partial<SubscriptionPlan> = { updatedAt: new Date() };
	if (patch.name !== undefined) next.name = patch.name;
	if (patch.creditsPerPeriod !== undefined) next.creditsPerPeriod = patch.creditsPerPeriod;
	if (patch.rolloverCap !== undefined) next.rolloverCap = patch.rolloverCap;
	if (patch.features !== undefined) next.features = patch.features;
	if (patch.description !== undefined) next.description = patch.description;
	if (patch.highlighted !== undefined) next.highlighted = patch.highlighted;
	if (patch.editorPro !== undefined) next.editorPro = patch.editorPro;
	if (patch.isActive !== undefined) next.isActive = patch.isActive;
	if (patch.sortOrder !== undefined) next.sortOrder = patch.sortOrder;
	if (patch.currency !== undefined) next.currency = patch.currency;
	// Name change → sync the Stripe product name.
	if (patch.name !== undefined && patch.name !== existing.name && existing.stripeProductId) {
		await getStripeGateway().updateProductName(existing.stripeProductId, patch.name);
	}
	const intervalChanged = patch.interval !== undefined && patch.interval !== existing.interval;
	const priceChanged = patch.priceCents !== undefined && patch.priceCents !== existing.priceCents;
	const currencyChanged = patch.currency !== undefined && patch.currency !== existing.currency;
	if (intervalChanged) next.interval = patch.interval;
	if (priceChanged) next.priceCents = patch.priceCents;
	// Currency, price, or interval change → reuse the existing product and provision a NEW Stripe price.
	if ((intervalChanged || priceChanged || currencyChanged) && existing.stripeProductId) {
		const interval = next.interval ?? existing.interval;
		const priceCents = next.priceCents ?? existing.priceCents;
		const { priceId } = await getStripeGateway().createPriceForProduct({
			productId: existing.stripeProductId,
			amountCents: priceCents,
			currency: patch.currency ?? existing.currency,
			recurring: { interval: interval as "month" | "year" },
		});
		next.stripePriceId = priceId;
		if (existing.stripePriceId) await getStripeGateway().archivePrice(existing.stripePriceId);
	}
	const rows = await db.update(subscriptionPlans).set(next).where(eq(subscriptionPlans.id, id)).returning();
	return rows[0] ?? null;
}

export async function deactivatePlan(id: string): Promise<boolean> {
	const rows = await db
		.update(subscriptionPlans)
		.set({ isActive: false, updatedAt: new Date() })
		.where(eq(subscriptionPlans.id, id))
		.returning();
	return rows.length > 0;
}
