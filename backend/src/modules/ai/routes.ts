import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../../db/index";
import { users } from "../../db/schema";
import { resolveOwnerKey } from "../../lib/ownerKey";
import { resolveProjectAccess } from "../../lib/projectAccess";
import { getBucketBalances } from "./creditsRepo";
import { getModel, listModels, type AiModel } from "./modelRepo";
import { computeCreditsCharged } from "./pricing";

/** V1 typical-action token profiles for the selector's cost estimates.
 *  Code constants — revisit when real usage data accumulates. */
export const TYPICAL_ACTIONS = {
	chatMessage: { inputTokens: 2000, outputTokens: 500, cachedInputTokens: 0 },
	menuMigration: { inputTokens: 10_000, outputTokens: 3000, cachedInputTokens: 0 },
} as const;

function toPublicDto(m: AiModel) {
	return {
		id: m.id,
		displayName: m.displayName,
		description: m.description,
		badge: m.badge,
		creditsPerMInput: m.creditsPerMInput,
		creditsPerMOutput: m.creditsPerMOutput,
		estimates: {
			chatMessage: computeCreditsCharged(TYPICAL_ACTIONS.chatMessage, m),
			menuMigration: computeCreditsCharged(TYPICAL_ACTIONS.menuMigration, m),
		},
	};
}

export function buildAiRouter(): Hono {
	const r = new Hono();

	r.use("*", async (c, next) => {
		const ownerKey = await resolveOwnerKey(c);
		if (!ownerKey) return c.json({ error: "Unauthorized" }, 401);
		c.set("ownerKey", ownerKey);
		return next();
	});

	r.get("/models", async (c) => {
		const all = await listModels();
		const activeModels = all.filter((m) => m.isActive);
		const def = activeModels.find((m) => m.isDefault) ?? null;
		const ownerKey = c.get("ownerKey") as string;
		const rows = await db
			.select({ preferred: users.preferredAiModelId })
			.from(users)
			.where(eq(users.id, ownerKey.slice(5)));
		const preferredModelId = rows[0]?.preferred ?? null;
		return c.json({
			models: activeModels.map(toPublicDto),
			defaultModelId: def?.id ?? null,
			preferredModelId,
		});
	});

	r.get("/balance", async (c) => {
		const projectId = c.req.query("projectId") ?? "";
		const access = await resolveProjectAccess(c.get("ownerKey") as string, projectId);
		if (!access.ok)
			return c.json({ error: access.error }, access.error === "project_not_found" ? 404 : 403);
		const b = await getBucketBalances(access.networkId);
		return c.json({ balance: b.total, ...b });
	});

	r.put("/preferred-model", async (c) => {
		const ownerKey = c.get("ownerKey") as string;
		const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
		const modelId = typeof body.modelId === "string" ? body.modelId : "";
		const m = await getModel(modelId);
		if (!m?.isActive) return c.json({ error: "invalid_model" }, 400);
		await db
			.update(users)
			.set({ preferredAiModelId: m.id, updatedAt: new Date() })
			.where(eq(users.id, ownerKey.slice(5)));
		return c.json({ ok: true });
	});

	return r;
}
