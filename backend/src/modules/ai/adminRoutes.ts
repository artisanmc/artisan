import { Hono } from "hono";
import { eq } from "drizzle-orm";
import {
	AI_BADGES,
	createModel,
	getModel,
	listModels,
	setDefaultModel,
	updateModel,
	type AiBadge,
	type AiModel,
	type AiModelInput,
} from "./modelRepo";
import { hasUsableKey, listProvidersForAdmin, putProvider, createProviderFor } from "./providers";
import { getAiSettings, putAiSettings, type AiSettings } from "./settings";
import type { LlmProvider, LlmUsage } from "../assistant/provider/types";
import { computeCreditsCharged, computeRealCostMicroUsd, sumUsage } from "./pricing";
import { db } from "../../db/index";
import { networks } from "../../db/schema";
import { grantCredits } from "./creditsRepo";
import { usageSummary, listUsageLogs, usageLogsCsv, userFocus, type UsageLogFilters } from "./analytics";

let aiTestProvider: LlmProvider | null = null;
/** Test hook: inject a fake provider for POST /ai/models/:id/test. */
export function __setAiTestProviderForTests(p: LlmProvider | null): void {
	aiTestProvider = p;
}

function toDto(m: AiModel) {
	return { ...m, createdAt: m.createdAt.toISOString(), updatedAt: m.updatedAt.toISOString() };
}

/** null si invalide. `partial` autorise les champs manquants (PUT patch). */
function parseModelBody(
	body: Record<string, unknown>,
	partial: boolean,
): Partial<AiModelInput> | null {
	const out: Partial<AiModelInput> = {};
	const str = (k: string) => (typeof body[k] === "string" ? (body[k] as string) : undefined);
	const int = (k: string) =>
		typeof body[k] === "number" && Number.isInteger(body[k]) && (body[k] as number) >= 0
			? (body[k] as number)
			: undefined;
	const strFields = ["displayName", "description", "provider", "providerModelId"] as const;
	for (const k of strFields) {
		const v = str(k);
		if (v !== undefined) (out as Record<string, unknown>)[k] = v;
	}
	const intFields = ["creditsPerMInput", "creditsPerMOutput", "realUsdPerMInput", "realUsdPerMOutput"] as const;
	for (const k of intFields) {
		const v = int(k);
		if (v !== undefined) (out as Record<string, unknown>)[k] = v;
	}
	if (typeof body.badge === "string") {
		if (!AI_BADGES.includes(body.badge as AiBadge)) return null;
		out.badge = body.badge as AiBadge;
	}
	if (typeof body.isActive === "boolean") out.isActive = body.isActive;
	if (!partial) {
		if (!out.displayName || !out.provider || !out.providerModelId || !out.badge) return null;
		for (const k of intFields) if (out[k] === undefined) return null;
		out.description ??= "";
		out.isActive ??= true;
	}
	if (out.displayName === "") return null;
	return out;
}

export function buildAiAdminRouter(): Hono {
	const r = new Hono();

	r.get("/ai/models", async (c) => {
		return c.json({ models: (await listModels()).map(toDto) });
	});

	r.post("/ai/models", async (c) => {
		const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
		const input = parseModelBody(body, false);
		if (!input) return c.json({ error: "invalid_model" }, 400);
		if (input.isActive && !(await hasUsableKey(input.provider as string)))
			return c.json({ error: "provider_key_missing" }, 400);
		const m = await createModel(input as AiModelInput);
		return c.json(toDto(m));
	});

	r.get("/ai/models/:id", async (c) => {
		const m = await getModel(c.req.param("id"));
		return m ? c.json(toDto(m)) : c.json({ error: "not_found" }, 404);
	});

	r.put("/ai/models/:id", async (c) => {
		const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
		const patch = parseModelBody(body, true);
		if (!patch) return c.json({ error: "invalid_model" }, 400);
		const existing = await getModel(c.req.param("id"));
		if (!existing) return c.json({ error: "not_found" }, 404);
		const willBeActive = patch.isActive ?? existing.isActive;
		const provider = (patch.provider as string) ?? existing.provider;
		if (willBeActive && !(await hasUsableKey(provider)))
			return c.json({ error: "provider_key_missing" }, 400);
		const m = await updateModel(existing.id, patch);
		if (!m) return c.json({ error: "not_found" }, 404);
		return c.json(toDto(m));
	});

	r.put("/ai/models/:id/default", async (c) => {
		const m = await getModel(c.req.param("id"));
		if (!m) return c.json({ error: "not_found" }, 404);
		if (!m.isActive) return c.json({ error: "model_inactive" }, 400);
		await setDefaultModel(m.id);
		return c.json({ ok: true });
	});

	r.post("/ai/models/:id/test", async (c) => {
		const m = await getModel(c.req.param("id"));
		if (!m) return c.json({ error: "not_found" }, 404);
		const provider = aiTestProvider ?? (await createProviderFor(m));
		if (!provider) return c.json({ ok: false, error: "provider_key_missing" });
		const t0 = performance.now();
		const usages: LlmUsage[] = [];
		try {
			let sawDone = false;
			for await (const ev of provider.streamTurn({
				messages: [{ role: "user", content: "Reply with OK." }],
				tools: [],
				model: m.providerModelId,
			})) {
				if (ev.type === "usage") usages.push(ev.usage);
				if (ev.type === "done") sawDone = true;
			}
			const usage = sumUsage(usages);
			return c.json({
				ok: sawDone,
				latencyMs: Math.round(performance.now() - t0),
				inputTokens: usage.inputTokens,
				outputTokens: usage.outputTokens,
				creditsCost: computeCreditsCharged(usage, m),
				realCostMicroUsd: computeRealCostMicroUsd(usage, m),
			});
		} catch (e) {
			return c.json({ ok: false, error: e instanceof Error ? e.message : "error" });
		}
	});

	r.get("/ai/providers", async (c) => {
		return c.json({ providers: await listProvidersForAdmin() });
	});

	r.put("/ai/providers/:slug", async (c) => {
		const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
		const res = await putProvider(
			c.req.param("slug"),
			{
				label: typeof body.label === "string" ? body.label : undefined,
				baseUrl: typeof body.baseUrl === "string" ? body.baseUrl : undefined,
				apiKey: typeof body.apiKey === "string" ? body.apiKey : undefined,
			},
			c.get("user")?.id ?? null,
		);
		if (!res.ok) return c.json({ error: res.error }, 503);
		return c.json({ ok: true });
	});

	r.get("/ai/settings", async (c) => c.json(await getAiSettings()));

	r.put("/ai/settings", async (c) => {
		const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
		const patch: Partial<AiSettings> = {};
		if (typeof body.creditUsdMicroRate === "number" && Number.isInteger(body.creditUsdMicroRate) && body.creditUsdMicroRate >= 0)
			patch.creditUsdMicroRate = body.creditUsdMicroRate;
		if (typeof body.pricingMarginPct === "number" && Number.isInteger(body.pricingMarginPct) && body.pricingMarginPct >= 0)
			patch.pricingMarginPct = body.pricingMarginPct;
		if (body.maxCreditsPerTurn === null) patch.maxCreditsPerTurn = null;
		else if (typeof body.maxCreditsPerTurn === "number" && Number.isInteger(body.maxCreditsPerTurn) && body.maxCreditsPerTurn > 0)
			patch.maxCreditsPerTurn = body.maxCreditsPerTurn;
		return c.json(await putAiSettings(patch, c.get("user")?.id ?? null));
	});

	r.post("/ai/credits/grant", async (c) => {
		const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
		const networkId = typeof body.networkId === "string" ? body.networkId : "";
		const amount = body.amount;
		if (typeof amount !== "number" || !Number.isInteger(amount) || amount <= 0)
			return c.json({ error: "invalid_amount" }, 400);
		const net = await db.select({ id: networks.id }).from(networks).where(eq(networks.id, networkId));
		if (net.length === 0) return c.json({ error: "network_not_found" }, 404);
		const { balance } = await grantCredits({
			networkId,
			amount,
			note: typeof body.note === "string" ? body.note : undefined,
			createdBy: c.get("user")?.id ?? null,
		});
		return c.json({ ok: true, balance });
	});

	r.get("/ai/usage/summary", async (c) => {
		const to = c.req.query("to") ? new Date(c.req.query("to") as string) : new Date();
		const from = c.req.query("from")
			? new Date(c.req.query("from") as string)
			: new Date(to.getTime() - 30 * 24 * 3_600_000);
		if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()))
			return c.json({ error: "invalid_range" }, 400);
		return c.json(await usageSummary(from, to));
	});

	r.get("/ai/usage/logs", async (c) => {
		const q = (k: string) => c.req.query(k) || undefined;
		const parseDate = (k: string) => {
			const v = q(k);
			if (!v) return undefined;
			const d = new Date(v);
			return Number.isNaN(d.getTime()) ? undefined : d;
		};
		const filters: UsageLogFilters = {
			userId: q("userId"), modelId: q("modelId"), provider: q("provider"),
			actionType: q("actionType"), status: q("status"),
			from: parseDate("from"), to: parseDate("to"),
		};
		if (q("format") === "csv") {
			c.header("Content-Type", "text/csv; charset=utf-8");
			c.header("Content-Disposition", 'attachment; filename="ai-usage.csv"');
			return c.body(await usageLogsCsv(filters));
		}
		const limit = Math.min(Math.max(Number(q("limit") ?? 50) || 50, 1), 200);
		return c.json(await listUsageLogs(filters, q("cursor"), limit));
	});

	r.get("/ai/users/:userId", async (c) => {
		const to = c.req.query("to") ? new Date(c.req.query("to") as string) : new Date();
		const from = c.req.query("from")
			? new Date(c.req.query("from") as string)
			: new Date(to.getTime() - 30 * 24 * 3_600_000);
		if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()))
			return c.json({ error: "invalid_range" }, 400);
		return c.json(await userFocus(c.req.param("userId"), from, to));
	});

	return r;
}
