import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../../db/index";
import { aiUsageLog, appSettings, networks, users } from "../../db/schema";
import { createNetwork } from "../../lib/networkManager";
import { createSession } from "../../lib/sessionManager";
import { app } from "../../app";
import { setSetting } from "../../lib/appSettings";
import { AI_SETTINGS_KEY } from "./settings";
import { usageSummary } from "./analytics";

const ADMIN_ID = "user_admin_aianalytics";
let adminSession = "";
let networkId = "";

function row(over: Partial<typeof aiUsageLog.$inferInsert>): typeof aiUsageLog.$inferInsert {
	return {
		id: crypto.randomUUID(), networkId, userId: null, serverKeyId: null,
		modelId: null, modelName: "M1", provider: "openai", providerModelId: "m1",
		actionType: "chat", conversationId: null,
		inputTokens: 1000, outputTokens: 100, cachedInputTokens: 0,
		creditsCharged: 10, realCostMicroUsd: 5000, durationMs: 100,
		status: "success", errorMessage: null, promptPreview: "",
		createdAt: new Date("2026-07-01T10:00:00Z"),
		...over,
	};
}

beforeAll(async () => {
	const now = new Date();
	await db.insert(users).values({ id: ADMIN_ID, email: `${ADMIN_ID}@example.com`, name: "A", isAdmin: true, createdAt: now, updatedAt: now }).onConflictDoNothing();
	adminSession = (await createSession(ADMIN_ID)).id;
	networkId = (await createNetwork("analytics-net")).id;
	await setSetting(AI_SETTINGS_KEY, { creditUsdMicroRate: 10_000, maxCreditsPerTurn: null }, null);
	await db.insert(aiUsageLog).values([
		row({}),
		row({ modelName: "M2", provider: "anthropic", providerModelId: "m2", creditsCharged: 90, realCostMicroUsd: 400_000, createdAt: new Date("2026-07-02T09:00:00Z") }),
		row({ status: "error", creditsCharged: 0 }),
		row({ createdAt: new Date("2026-05-01T00:00:00Z") }), // out of range
	]);
});

afterAll(async () => {
	await db.delete(aiUsageLog).where(eq(aiUsageLog.networkId, networkId));
	await db.delete(networks).where(eq(networks.id, networkId));
	await db.delete(appSettings).where(eq(appSettings.key, AI_SETTINGS_KEY));
	await db.delete(users).where(eq(users.id, ADMIN_ID));
});

describe("usageSummary", () => {
	const from = new Date("2026-06-30T00:00:00Z");
	const to = new Date("2026-07-03T00:00:00Z");

	it("totals within range, margin computed at the credit rate", async () => {
		const s = await usageSummary(from, to);
		expect(s.totals.turns).toBe(3);
		expect(s.totals.errors).toBe(1);
		expect(s.totals.creditsCharged).toBe(100);
		expect(s.totals.realCostMicroUsd).toBe(410_000);
		// 100 credits × 10_000 µ$ − 410_000 µ$ = 590_000 µ$
		expect(s.totals.marginMicroUsd).toBe(590_000);
	});

	it("groups by model, provider, and day", async () => {
		const s = await usageSummary(from, to);
		expect(s.byModel.map((m) => m.modelName).sort()).toEqual(["M1", "M2"]);
		expect(s.byProvider.find((p) => p.provider === "anthropic")?.creditsCharged).toBe(90);
		expect(s.daily.map((d) => d.date)).toEqual(["2026-07-01", "2026-07-02"]);
	});
});

describe("GET /api/v1/admin/ai/usage/summary", () => {
	it("serves the summary to admins", async () => {
		const res = await app.request(
			"/api/v1/admin/ai/usage/summary?from=2026-06-30T00:00:00Z&to=2026-07-03T00:00:00Z",
			{ headers: { Cookie: `artisan_user_session=${adminSession}` } },
		);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.totals.turns).toBe(3);
	});
});
