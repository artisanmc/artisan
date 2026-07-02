import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { app } from "../../app";
import { db } from "../../db/index";
import { aiModels, appSettings, users } from "../../db/schema";
import { createSession } from "../../lib/sessionManager";
import { __setAiTestProviderForTests } from "./adminRoutes";
import { createModel } from "./modelRepo";
import { AI_PROVIDERS_SETTING_KEY, putProvider } from "./providers";
import type { LlmProvider } from "../assistant/provider/types";

const ADMIN_ID = "user_admin_aitest";
let adminSession = "";
let modelId = "";

function fakeProvider(): LlmProvider {
	return {
		async *streamTurn() {
			yield { type: "text", text: "OK" };
			yield { type: "usage", usage: { inputTokens: 12, outputTokens: 2 } };
			yield { type: "done", stopReason: "end_turn" };
		},
	};
}

beforeAll(async () => {
	process.env.CONFIG_ENC_KEY = "0".repeat(64);
	const now = new Date();
	await db.insert(users).values({ id: ADMIN_ID, email: `${ADMIN_ID}@example.com`, name: "Admin", isAdmin: true, createdAt: now, updatedAt: now }).onConflictDoNothing();
	adminSession = (await createSession(ADMIN_ID)).id;
	await putProvider("anthropic", { apiKey: "sk-ant-test" }, null);
	modelId = (
		await createModel({
			displayName: "Sonnet 5", description: "", badge: "balanced",
			provider: "anthropic", providerModelId: "claude-sonnet-5",
			creditsPerMInput: 1_000_000, creditsPerMOutput: 2_000_000,
			realUsdPerMInput: 3_000_000, realUsdPerMOutput: 15_000_000, isActive: true,
		})
	).id;
	__setAiTestProviderForTests(fakeProvider());
});

afterAll(async () => {
	__setAiTestProviderForTests(null);
	await db.delete(aiModels);
	await db.delete(appSettings).where(eq(appSettings.key, AI_PROVIDERS_SETTING_KEY));
	await db.delete(users).where(eq(users.id, ADMIN_ID));
});

const adminHeaders = () => ({ Cookie: `artisan_user_session=${adminSession}`, "Content-Type": "application/json" });

describe("admin ai model test route", () => {
	it("returns ok + latency + usage + costs computed at the model's prices", async () => {
		const res = await app.request(`/api/v1/admin/ai/models/${modelId}/test`, {
			method: "POST", headers: adminHeaders(),
		});
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.ok).toBe(true);
		expect(typeof body.latencyMs).toBe("number");
		expect(body.inputTokens).toBe(12);
		expect(body.outputTokens).toBe(2);
		// Asymmetric prices pin the per-direction weights:
		// ceil((12·1M + 2·2M)/1M) = 12 + 4 = 16
		expect(body.creditsCost).toBe(16);
		// round((12·3M + 2·15M)/1M) = 36 + 30 = 66 micro-USD
		expect(body.realCostMicroUsd).toBe(66);
	});

	it("model on a keyless provider → ok:false provider_key_missing", async () => {
		__setAiTestProviderForTests(null); // let the route resolve the real provider
		try {
			const keyless = await createModel({
				displayName: "Keyless", description: "", badge: "cheap",
				provider: "deepseek", providerModelId: "ds-x",
				creditsPerMInput: 1, creditsPerMOutput: 1,
				realUsdPerMInput: 0, realUsdPerMOutput: 0, isActive: false,
			});
			const res = await app.request(`/api/v1/admin/ai/models/${keyless.id}/test`, {
				method: "POST", headers: adminHeaders(),
			});
			expect(res.status).toBe(200);
			expect(await res.json()).toEqual({ ok: false, error: "provider_key_missing" });
		} finally {
			__setAiTestProviderForTests(fakeProvider());
		}
	});

	it("unknown model → 404", async () => {
		const res = await app.request("/api/v1/admin/ai/models/nope/test", {
			method: "POST", headers: adminHeaders(),
		});
		expect(res.status).toBe(404);
	});
});
