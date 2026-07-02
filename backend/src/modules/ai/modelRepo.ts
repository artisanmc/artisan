import { eq } from "drizzle-orm";
import { db } from "../../db/index";
import { aiModels } from "../../db/schema";

export type AiBadge = "cheap" | "balanced" | "premium";
export const AI_BADGES: AiBadge[] = ["cheap", "balanced", "premium"];

export interface AiModel {
	id: string;
	displayName: string;
	description: string;
	badge: AiBadge;
	provider: string;
	providerModelId: string;
	creditsPerMInput: number;
	creditsPerMOutput: number;
	realUsdPerMInput: number;
	realUsdPerMOutput: number;
	isActive: boolean;
	isDefault: boolean;
	createdAt: Date;
	updatedAt: Date;
}

export type AiModelInput = Omit<AiModel, "id" | "isDefault" | "createdAt" | "updatedAt">;

const BADGE_ORDER: Record<AiBadge, number> = { cheap: 0, balanced: 1, premium: 2 };

function toModel(r: typeof aiModels.$inferSelect): AiModel {
	return { ...r, badge: r.badge as AiBadge };
}

export async function listModels(): Promise<AiModel[]> {
	const rows = await db.select().from(aiModels);
	// Byte-order name sort (never localeCompare — house invariant).
	return rows.map(toModel).sort((a, b) => (a.displayName < b.displayName ? -1 : 1));
}

export async function getModel(id: string): Promise<AiModel | null> {
	const rows = await db.select().from(aiModels).where(eq(aiModels.id, id));
	return rows.length > 0 ? toModel(rows[0]) : null;
}

export async function createModel(input: AiModelInput): Promise<AiModel> {
	const now = new Date();
	const row = { id: crypto.randomUUID(), ...input, isDefault: false, createdAt: now, updatedAt: now };
	await db.insert(aiModels).values(row);
	return toModel(row as typeof aiModels.$inferSelect);
}

export async function updateModel(
	id: string,
	patch: Partial<AiModelInput>,
): Promise<AiModel | null> {
	const rows = await db
		.update(aiModels)
		.set({ ...patch, updatedAt: new Date() })
		.where(eq(aiModels.id, id))
		.returning();
	return rows.length > 0 ? toModel(rows[0]) : null;
}

/** Make `id` the single default (transaction: unset old, set new). False if unknown. */
export async function setDefaultModel(id: string): Promise<boolean> {
	return db.transaction(async (tx) => {
		const target = await tx
			.select({ id: aiModels.id })
			.from(aiModels)
			.where(eq(aiModels.id, id));
		if (target.length === 0) return false;
		await tx.update(aiModels).set({ isDefault: false }).where(eq(aiModels.isDefault, true));
		await tx
			.update(aiModels)
			.set({ isDefault: true, updatedAt: new Date() })
			.where(eq(aiModels.id, id));
		return true;
	});
}

/**
 * Model resolution for a turn: requested (if active) → active default →
 * deterministic fallback (first active, badge order cheap→premium then byte-order
 * name) → null (no usable catalog).
 */
export async function resolveModel(requestedId?: string | null): Promise<AiModel | null> {
	if (requestedId) {
		const m = await getModel(requestedId);
		if (m?.isActive) return m;
	}
	const all = await listModels();
	const def = all.find((m) => m.isDefault && m.isActive);
	if (def) return def;
	const active = all
		.filter((m) => m.isActive)
		.sort(
			(a, b) =>
				BADGE_ORDER[a.badge] - BADGE_ORDER[b.badge] ||
				(a.displayName < b.displayName ? -1 : 1),
		);
	return active[0] ?? null;
}
