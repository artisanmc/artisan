import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { app } from "../../app";
import { db } from "../../db/index";
import {
	aiModels,
	memberships,
	networks,
	projects,
	serverKeys,
	users,
} from "../../db/schema";
import { createNetwork } from "../../lib/networkManager";
import { createSession } from "../../lib/sessionManager";
import { generateServerKey } from "../../lib/auth";
import { grantCredits } from "./creditsRepo";
import { createModel, setDefaultModel, type AiModel } from "./modelRepo";

const PROJECT_ID = "proj_ai_routes";
const USER_ID = "usr_ai_routes";
const OUTSIDER_ID = "usr_ai_routes_outsider";
let networkId = "";
let userSession = "";
let outsiderSession = "";
let active: AiModel;
let inactive: AiModel;

const cookie = () => ({ Cookie: `artisan_user_session=${userSession}`, "Content-Type": "application/json" });
const outsiderCookie = () => ({ Cookie: `artisan_user_session=${outsiderSession}`, "Content-Type": "application/json" });

beforeAll(async () => {
	networkId = (await createNetwork("ai-routes-network")).id;
	const now = new Date();
	const { id: serverKeyId, hash } = await generateServerKey();
	await db.insert(serverKeys).values({ id: serverKeyId, hash, networkId, createdAt: now }).onConflictDoNothing();
	await db.insert(projects).values({
		id: PROJECT_ID, networkId, serverKeyId, name: "AI Routes",
		hash: "", filesJson: "{}", createdAt: now, updatedAt: now,
	}).onConflictDoNothing();
	for (const [id, email] of [[USER_ID, "ai-routes@example.com"], [OUTSIDER_ID, "ai-routes-out@example.com"]] as const) {
		await db.insert(users).values({ id, email, name: id, createdAt: now, updatedAt: now }).onConflictDoNothing();
	}
	await db.insert(memberships).values({
		id: "mem_ai_routes", userId: USER_ID, networkId, role: "owner", createdAt: now,
	}).onConflictDoNothing();
	userSession = (await createSession(USER_ID)).id;
	outsiderSession = (await createSession(OUTSIDER_ID)).id;
	active = await createModel({
		displayName: "Active Model", description: "Fast and cheap", badge: "cheap",
		provider: "openai", providerModelId: "active-x",
		creditsPerMInput: 1000, creditsPerMOutput: 2000,
		realUsdPerMInput: 0, realUsdPerMOutput: 0, isActive: true,
	});
	inactive = await createModel({
		displayName: "Hidden Model", description: "", badge: "premium",
		provider: "openai", providerModelId: "hidden-x",
		creditsPerMInput: 1, creditsPerMOutput: 1,
		realUsdPerMInput: 0, realUsdPerMOutput: 0, isActive: false,
	});
	await setDefaultModel(active.id);
	await grantCredits({ networkId, amount: 250 });
});

afterAll(async () => {
	await db.delete(aiModels);
	await db.delete(networks).where(eq(networks.id, networkId));
	await db.delete(users).where(eq(users.id, USER_ID));
	await db.delete(users).where(eq(users.id, OUTSIDER_ID));
});

describe("GET /api/v1/ai/models", () => {
	it("401 without auth", async () => {
		expect((await app.request("/api/v1/ai/models")).status).toBe(401);
	});

	it("lists ACTIVE models only, with estimates at the model's prices", async () => {
		const res = await app.request("/api/v1/ai/models", { headers: cookie() });
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.models.length).toBe(1);
		expect(body.models[0].displayName).toBe("Active Model");
		expect(body.defaultModelId).toBe(active.id);
		// chatMessage: ceil((2000·1000 + 500·2000)/1M) = 3
		expect(body.models[0].estimates.chatMessage).toBe(3);
		// menuMigration: ceil((10000·1000 + 3000·2000)/1M) = 16
		expect(body.models[0].estimates.menuMigration).toBe(16);
		// Never expose real USD prices to users.
		expect(JSON.stringify(body)).not.toContain("realUsd");
	});

	it("returns the user's preferredModelId on cookie sessions", async () => {
		await db.update(users).set({ preferredAiModelId: active.id }).where(eq(users.id, USER_ID));
		const body = await (await app.request("/api/v1/ai/models", { headers: cookie() })).json();
		expect(body.preferredModelId).toBe(active.id);
	});
});

describe("GET /api/v1/ai/balance", () => {
	it("user session requires a membership on the project's network", async () => {
		const ok = await app.request(`/api/v1/ai/balance?projectId=${PROJECT_ID}`, { headers: cookie() });
		expect(ok.status).toBe(200);
		const out = await app.request(`/api/v1/ai/balance?projectId=${PROJECT_ID}`, { headers: outsiderCookie() });
		expect(out.status).toBe(403);
	});

	it("404 for an unknown project", async () => {
		const res = await app.request("/api/v1/ai/balance?projectId=ghost", { headers: cookie() });
		expect(res.status).toBe(404);
	});

	it("returns the per-bucket breakdown", async () => {
		await grantCredits({ networkId, amount: 100, bucket: "subscription" });
		await grantCredits({ networkId, amount: 50, bucket: "rollover" });
		const res = await app.request(`/api/v1/ai/balance?projectId=${PROJECT_ID}`, { headers: cookie() });
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.subscription).toBe(100);
		expect(body.rollover).toBe(50);
		expect(body.topup).toBe(250);
		expect(body.total).toBe(body.subscription + body.rollover + body.topup);
		expect(body.balance).toBe(body.total);
	});
});

describe("PUT /api/v1/ai/preferred-model", () => {
	it("persists for user sessions", async () => {
		const res = await app.request("/api/v1/ai/preferred-model", {
			method: "PUT", headers: cookie(), body: JSON.stringify({ modelId: active.id }),
		});
		expect(res.status).toBe(200);
		const [u] = await db.select().from(users).where(eq(users.id, USER_ID));
		expect(u.preferredAiModelId).toBe(active.id);
	});

	it("400 for inactive/unknown models", async () => {
		const bad = await app.request("/api/v1/ai/preferred-model", {
			method: "PUT", headers: cookie(), body: JSON.stringify({ modelId: inactive.id }),
		});
		expect(bad.status).toBe(400);
	});
});
