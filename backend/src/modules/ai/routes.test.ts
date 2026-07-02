import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { app } from "../../app";
import { db } from "../../db/index";
import {
	aiCreditLedger,
	aiModels,
	editorSessions,
	memberships,
	networks,
	projects,
	serverKeys,
	users,
} from "../../db/schema";
import { createNetwork } from "../../lib/networkManager";
import { createSession } from "../../lib/sessionManager";
import { grantCredits } from "./creditsRepo";
import { createModel, setDefaultModel, type AiModel } from "./modelRepo";

const SRV = "srv_ai_routes";
const ACCESS = "acc_ai_routes";
const PROJECT_ID = "proj_ai_routes";
const USER_ID = "usr_ai_routes";
const OUTSIDER_ID = "usr_ai_routes_outsider";
let networkId = "";
let userSession = "";
let outsiderSession = "";
let active: AiModel;
let inactive: AiModel;

const bearer = { Authorization: `Bearer ${ACCESS}`, "Content-Type": "application/json" };
const cookie = () => ({ Cookie: `artisan_user_session=${userSession}`, "Content-Type": "application/json" });

beforeAll(async () => {
	networkId = (await createNetwork("ai-routes-network")).id;
	const now = new Date();
	const future = new Date(Date.now() + 3_600_000);
	await db.insert(serverKeys).values({ id: SRV, hash: "h_ai_routes", networkId, createdAt: now }).onConflictDoNothing();
	await db.insert(editorSessions).values({
		token: "url_ai_routes", serverKeyId: SRV, createdBy: "CONSOLE",
		createdAt: now, expiresAt: future, accessToken: ACCESS, accessExpiresAt: future,
	}).onConflictDoNothing();
	await db.insert(projects).values({
		id: PROJECT_ID, networkId, serverKeyId: SRV, name: "AI Routes",
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
	await db.delete(editorSessions).where(eq(editorSessions.token, "url_ai_routes"));
	await db.delete(networks).where(eq(networks.id, networkId));
	await db.delete(users).where(eq(users.id, USER_ID));
	await db.delete(users).where(eq(users.id, OUTSIDER_ID));
});

describe("GET /api/v1/ai/models", () => {
	it("401 without auth", async () => {
		expect((await app.request("/api/v1/ai/models")).status).toBe(401);
	});

	it("lists ACTIVE models only, with estimates at the model's prices", async () => {
		const res = await app.request("/api/v1/ai/models", { headers: bearer });
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.models.length).toBe(1);
		expect(body.models[0].displayName).toBe("Active Model");
		expect(body.defaultModelId).toBe(active.id);
		expect(body.preferredModelId).toBeNull(); // sk: session
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
	it("sk: session sees its project's network balance", async () => {
		const res = await app.request(`/api/v1/ai/balance?projectId=${PROJECT_ID}`, { headers: bearer });
		expect(res.status).toBe(200);
		expect((await res.json()).balance).toBe(250);
	});

	it("user session requires a membership on the project's network", async () => {
		const ok = await app.request(`/api/v1/ai/balance?projectId=${PROJECT_ID}`, { headers: cookie() });
		expect(ok.status).toBe(200);
		const out = await app.request(`/api/v1/ai/balance?projectId=${PROJECT_ID}`, {
			headers: { Cookie: `artisan_user_session=${outsiderSession}` },
		});
		expect(out.status).toBe(403);
	});

	it("404 for an unknown project", async () => {
		const res = await app.request("/api/v1/ai/balance?projectId=ghost", { headers: bearer });
		expect(res.status).toBe(404);
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

	it("403 for sk: sessions; 400 for inactive/unknown models", async () => {
		const sk = await app.request("/api/v1/ai/preferred-model", {
			method: "PUT", headers: bearer, body: JSON.stringify({ modelId: active.id }),
		});
		expect(sk.status).toBe(403);
		const bad = await app.request("/api/v1/ai/preferred-model", {
			method: "PUT", headers: cookie(), body: JSON.stringify({ modelId: inactive.id }),
		});
		expect(bad.status).toBe(400);
	});
});
