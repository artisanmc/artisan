import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../../db/index";
import { memberships, projects, users } from "../../db/schema";
import { resolveOwnerKey } from "../../lib/ownerKey";
import { getBalance } from "./creditsRepo";
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
		let preferredModelId: string | null = null;
		if (ownerKey.startsWith("user:")) {
			const rows = await db
				.select({ preferred: users.preferredAiModelId })
				.from(users)
				.where(eq(users.id, ownerKey.slice(5)));
			preferredModelId = rows[0]?.preferred ?? null;
		}
		return c.json({
			models: activeModels.map(toPublicDto),
			defaultModelId: def?.id ?? null,
			preferredModelId,
		});
	});

	r.get("/balance", async (c) => {
		const projectId = c.req.query("projectId") ?? "";
		const rows = await db
			.select({ networkId: projects.networkId, serverKeyId: projects.serverKeyId })
			.from(projects)
			.where(eq(projects.id, projectId));
		if (rows.length === 0) return c.json({ error: "project_not_found" }, 404);
		const proj = rows[0];
		const ownerKey = c.get("ownerKey") as string;
		if (ownerKey.startsWith("sk:")) {
			if (proj.serverKeyId !== ownerKey.slice(3)) return c.json({ error: "forbidden" }, 403);
		} else {
			const member = await db
				.select({ id: memberships.id })
				.from(memberships)
				.where(
					and(
						eq(memberships.userId, ownerKey.slice(5)),
						eq(memberships.networkId, proj.networkId),
					),
				);
			if (member.length === 0) return c.json({ error: "forbidden" }, 403);
		}
		return c.json({ balance: await getBalance(proj.networkId) });
	});

	r.put("/preferred-model", async (c) => {
		const ownerKey = c.get("ownerKey") as string;
		if (!ownerKey.startsWith("user:"))
			return c.json({ error: "user_session_required" }, 403);
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
