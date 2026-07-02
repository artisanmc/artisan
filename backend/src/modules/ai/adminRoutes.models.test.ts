import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { app } from "../../app";
import { db } from "../../db/index";
import { aiModels, appSettings, users } from "../../db/schema";
import { createSession } from "../../lib/sessionManager";
import { createModel, getModel, setDefaultModel } from "./modelRepo";
import { AI_PROVIDERS_SETTING_KEY, putProvider } from "./providers";

const ADMIN_ID = "user_admin_aimodels";
const PLAIN_ID = "user_plain_aimodels";
let adminSession = "";
let plainSession = "";

const validBody = {
	displayName: "Sonnet 5",
	description: "Balanced default",
	badge: "balanced" as const, // literal, sinon TS widen en string ≠ AiBadge
	provider: "anthropic",
	providerModelId: "claude-sonnet-5",
	creditsPerMInput: 30,
	creditsPerMOutput: 150,
	realUsdPerMInput: 3_000_000,
	realUsdPerMOutput: 15_000_000,
	isActive: true,
};

beforeAll(async () => {
	process.env.CONFIG_ENC_KEY = "0".repeat(64);
	const now = new Date();
	await db.insert(users).values({ id: ADMIN_ID, email: `${ADMIN_ID}@example.com`, name: "Admin", isAdmin: true, createdAt: now, updatedAt: now }).onConflictDoNothing();
	await db.insert(users).values({ id: PLAIN_ID, email: `${PLAIN_ID}@example.com`, name: "Plain", isAdmin: false, createdAt: now, updatedAt: now }).onConflictDoNothing();
	adminSession = (await createSession(ADMIN_ID)).id;
	plainSession = (await createSession(PLAIN_ID)).id;
	await putProvider("anthropic", { apiKey: "sk-ant-test" }, null);
});

afterEach(async () => {
	await db.delete(aiModels);
});

afterAll(async () => {
	await db.delete(appSettings).where(eq(appSettings.key, AI_PROVIDERS_SETTING_KEY));
	await db.delete(users).where(eq(users.id, ADMIN_ID));
	await db.delete(users).where(eq(users.id, PLAIN_ID));
});

const adminHeaders = () => ({ Cookie: `artisan_user_session=${adminSession}`, "Content-Type": "application/json" });

describe("admin ai models routes", () => {
	it("403 without admin", async () => {
		const anon = await app.request("/api/v1/admin/ai/models");
		expect(anon.status).toBe(403);
		const plain = await app.request("/api/v1/admin/ai/models", {
			headers: { Cookie: `artisan_user_session=${plainSession}` },
		});
		expect(plain.status).toBe(403);
	});

	it("POST creates; GET lists; dates are ISO strings", async () => {
		const post = await app.request("/api/v1/admin/ai/models", {
			method: "POST", headers: adminHeaders(), body: JSON.stringify(validBody),
		});
		expect(post.status).toBe(200);
		const created = await post.json();
		expect(created.id).toBeDefined();
		expect(created.isDefault).toBe(false);
		const list = await (await app.request("/api/v1/admin/ai/models", { headers: adminHeaders() })).json();
		expect(list.models.length).toBe(1);
		expect(typeof list.models[0].createdAt).toBe("string");
	});

	it("POST validates: bad badge → 400; missing displayName → 400", async () => {
		const bad = await app.request("/api/v1/admin/ai/models", {
			method: "POST", headers: adminHeaders(),
			body: JSON.stringify({ ...validBody, badge: "ultra" }),
		});
		expect(bad.status).toBe(400);
		const noName = await app.request("/api/v1/admin/ai/models", {
			method: "POST", headers: adminHeaders(),
			body: JSON.stringify({ ...validBody, displayName: "" }),
		});
		expect(noName.status).toBe(400);
	});

	it("activation requires a usable provider key → 400 provider_key_missing", async () => {
		const res = await app.request("/api/v1/admin/ai/models", {
			method: "POST", headers: adminHeaders(),
			body: JSON.stringify({ ...validBody, provider: "deepseek" }), // no key stored
		});
		expect(res.status).toBe(400);
		expect((await res.json()).error).toBe("provider_key_missing");
		// Inactive creation is allowed without a key.
		const inactive = await app.request("/api/v1/admin/ai/models", {
			method: "POST", headers: adminHeaders(),
			body: JSON.stringify({ ...validBody, provider: "deepseek", isActive: false }),
		});
		expect(inactive.status).toBe(200);
	});

	it("PUT /:id patches; PUT /:id/default enforces single active default", async () => {
		const a = await createModel({ ...validBody, displayName: "A" });
		const b = await createModel({ ...validBody, displayName: "B" });
		await setDefaultModel(a.id);
		const setB = await app.request(`/api/v1/admin/ai/models/${b.id}/default`, {
			method: "PUT", headers: adminHeaders(),
		});
		expect(setB.status).toBe(200);
		expect((await getModel(a.id))?.isDefault).toBe(false);
		expect((await getModel(b.id))?.isDefault).toBe(true);
		// Default must be active.
		const inactive = await createModel({ ...validBody, displayName: "C", isActive: false });
		const setC = await app.request(`/api/v1/admin/ai/models/${inactive.id}/default`, {
			method: "PUT", headers: adminHeaders(),
		});
		expect(setC.status).toBe(400);
		expect((await setC.json()).error).toBe("model_inactive");
	});

	it("no DELETE route (deactivation only)", async () => {
		const m = await createModel(validBody);
		const del = await app.request(`/api/v1/admin/ai/models/${m.id}`, {
			method: "DELETE", headers: adminHeaders(),
		});
		expect(del.status).toBe(404);
	});
});
