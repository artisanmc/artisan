import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { app } from "../../app";
import { db } from "../../db/index";
import { appSettings, users } from "../../db/schema";
import { createSession } from "../../lib/sessionManager";
import { AI_PROVIDERS_SETTING_KEY } from "./providers";
import { AI_SETTINGS_KEY } from "./settings";

const ADMIN_ID = "user_admin_aiprov";
let adminSession = "";

beforeAll(async () => {
	process.env.CONFIG_ENC_KEY = "0".repeat(64);
	const now = new Date();
	await db.insert(users).values({ id: ADMIN_ID, email: `${ADMIN_ID}@example.com`, name: "Admin", isAdmin: true, createdAt: now, updatedAt: now }).onConflictDoNothing();
	adminSession = (await createSession(ADMIN_ID)).id;
});

afterEach(async () => {
	await db.delete(appSettings).where(eq(appSettings.key, AI_PROVIDERS_SETTING_KEY));
	await db.delete(appSettings).where(eq(appSettings.key, AI_SETTINGS_KEY));
});

afterAll(async () => {
	await db.delete(users).where(eq(users.id, ADMIN_ID));
});

const adminHeaders = () => ({ Cookie: `artisan_user_session=${adminSession}`, "Content-Type": "application/json" });

describe("admin ai providers + settings routes", () => {
	it("GET providers lists presets; PUT stores a key write-only", async () => {
		const before = await (await app.request("/api/v1/admin/ai/providers", { headers: adminHeaders() })).json();
		expect(before.providers.anthropic.preset).toBe(true);
		expect(before.providers.anthropic.keySet).toBe(false);

		const put = await app.request("/api/v1/admin/ai/providers/anthropic", {
			method: "PUT", headers: adminHeaders(), body: JSON.stringify({ apiKey: "sk-ant-xyz" }),
		});
		expect(put.status).toBe(200);

		const after = await (await app.request("/api/v1/admin/ai/providers", { headers: adminHeaders() })).json();
		expect(after.providers.anthropic.keySet).toBe(true);
		expect(JSON.stringify(after)).not.toContain("sk-ant-xyz");
	});

	it("PUT provider with a key while encryption is unconfigured → 503", async () => {
		const saved = process.env.CONFIG_ENC_KEY;
		delete process.env.CONFIG_ENC_KEY;
		const put = await app.request("/api/v1/admin/ai/providers/openai", {
			method: "PUT", headers: adminHeaders(), body: JSON.stringify({ apiKey: "sk-x" }),
		});
		expect(put.status).toBe(503);
		process.env.CONFIG_ENC_KEY = saved;
	});

	it("settings GET returns defaults; PUT patches", async () => {
		const defaults = await (await app.request("/api/v1/admin/ai/settings", { headers: adminHeaders() })).json();
		expect(defaults.creditUsdMicroRate).toBe(10_000);
		expect(defaults.maxCreditsPerTurn).toBeNull();
		const put = await app.request("/api/v1/admin/ai/settings", {
			method: "PUT", headers: adminHeaders(), body: JSON.stringify({ maxCreditsPerTurn: 80 }),
		});
		expect((await put.json()).maxCreditsPerTurn).toBe(80);
	});
});
