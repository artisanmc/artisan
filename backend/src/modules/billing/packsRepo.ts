import { eq } from "drizzle-orm";
import { db } from "../../db/index";
import { creditPacks } from "../../db/schema";
import { getStripeGateway } from "./stripe";

export interface CreditPack {
	id: string;
	name: string;
	priceCents: number;
	currency: string;
	credits: number;
	bonusPct: number;
	isActive: boolean;
	sortOrder: number;
	stripeProductId: string | null;
	stripePriceId: string | null;
	createdAt: Date;
	updatedAt: Date;
}
export type PackInput = {
	name: string;
	priceCents: number;
	currency?: string;
	credits: number;
	bonusPct?: number;
	isActive?: boolean;
	sortOrder?: number;
};

/** Credits actually granted for a pack purchase: base + additive bonus. */
export function creditsForPack(p: Pick<CreditPack, "credits" | "bonusPct">): number {
	return p.credits + Math.round((p.credits * p.bonusPct) / 100);
}

export async function listPacks(): Promise<CreditPack[]> {
	return db.select().from(creditPacks).orderBy(creditPacks.sortOrder);
}
export async function getPack(id: string): Promise<CreditPack | null> {
	const rows = await db.select().from(creditPacks).where(eq(creditPacks.id, id));
	return rows[0] ?? null;
}

export async function createPack(input: PackInput): Promise<CreditPack> {
	const currency = input.currency ?? "eur";
	const { productId, priceId } = await getStripeGateway().createProductWithPrice({
		name: input.name,
		amountCents: input.priceCents,
		currency,
	});
	const now = new Date();
	const row = {
		id: crypto.randomUUID(),
		name: input.name,
		priceCents: input.priceCents,
		currency,
		credits: input.credits,
		bonusPct: input.bonusPct ?? 0,
		isActive: input.isActive ?? true,
		sortOrder: input.sortOrder ?? 0,
		stripeProductId: productId,
		stripePriceId: priceId,
		createdAt: now,
		updatedAt: now,
	};
	await db.insert(creditPacks).values(row);
	return row;
}

export async function updatePack(id: string, patch: Partial<PackInput>): Promise<CreditPack | null> {
	const existing = await getPack(id);
	if (!existing) return null;
	const next: Partial<CreditPack> = { updatedAt: new Date() };
	if (patch.name !== undefined) next.name = patch.name;
	if (patch.credits !== undefined) next.credits = patch.credits;
	if (patch.bonusPct !== undefined) next.bonusPct = patch.bonusPct;
	if (patch.isActive !== undefined) next.isActive = patch.isActive;
	if (patch.sortOrder !== undefined) next.sortOrder = patch.sortOrder;
	if (patch.currency !== undefined) next.currency = patch.currency;
	// Name change → sync the Stripe product name.
	if (patch.name !== undefined && patch.name !== existing.name && existing.stripeProductId) {
		await getStripeGateway().updateProductName(existing.stripeProductId, patch.name);
	}
	// Currency or amount change → reuse the existing product and provision a NEW Stripe price.
	const currencyChanged = patch.currency !== undefined && patch.currency !== existing.currency;
	const priceChanged = patch.priceCents !== undefined && patch.priceCents !== existing.priceCents;
	if (priceChanged) next.priceCents = patch.priceCents;
	if ((priceChanged || currencyChanged) && existing.stripeProductId) {
		const priceCents = next.priceCents ?? existing.priceCents;
		const { priceId } = await getStripeGateway().createPriceForProduct({
			productId: existing.stripeProductId,
			amountCents: priceCents,
			currency: patch.currency ?? existing.currency,
		});
		next.stripePriceId = priceId;
		if (existing.stripePriceId) await getStripeGateway().archivePrice(existing.stripePriceId);
	}
	const rows = await db.update(creditPacks).set(next).where(eq(creditPacks.id, id)).returning();
	return rows[0] ?? null;
}

export async function deactivatePack(id: string): Promise<boolean> {
	const rows = await db
		.update(creditPacks)
		.set({ isActive: false, updatedAt: new Date() })
		.where(eq(creditPacks.id, id))
		.returning();
	return rows.length > 0;
}
