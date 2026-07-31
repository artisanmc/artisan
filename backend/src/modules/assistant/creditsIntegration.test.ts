import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { app } from "../../app";
import { db } from "../../db/index";
import {
	aiModels,
	aiUsageLog,
	appSettings,
	memberships,
	networks,
	projects,
	serverKeys,
	users,
} from "../../db/schema";
import { createNetwork } from "../../lib/networkManager";
import { getBalance, grantCredits } from "../ai/creditsRepo";
import { createModel, setDefaultModel, type AiModel } from "../ai/modelRepo";
import { AI_SETTINGS_KEY } from "../ai/settings";
import { setSetting } from "../../lib/appSettings";
import { createSession } from "../../lib/sessionManager";
import { generateServerKey } from "../../lib/auth";
import type { LlmProvider } from "./provider/types";
import { __setProviderForTests } from "./routes";

const PROJECT_ID = "proj_credits_int";
const USER_ID = "usr_credits_int";
let networkId = "";
let userSessionId = "";
let defaultModel: AiModel;
let altModel: AiModel;

const auth = () => ({ Cookie: `artisan_user_session=${userSessionId}`, "Content-Type": "application/json" });

/** Provider whose turn emits usage worth exactly 700 credits at the default prices. */
function usageProvider(): LlmProvider {
	return {
		async *streamTurn() {
			yield { type: "text", text: "done" };
			yield { type: "usage", usage: { inputTokens: 500_000, outputTokens: 100_000 } };
			yield { type: "done", stopReason: "end_turn" };
		},
	};
}

function throwingProvider(): LlmProvider {
	return {
		async *streamTurn() {
			yield { type: "usage", usage: { inputTokens: 9000, outputTokens: 0 } };
			throw new Error("provider exploded");
		},
	};
}

async function openConversation(): Promise<string> {
	const created = await app.request("/api/v1/assistant/conversations", {
		method: "POST", headers: auth(), body: JSON.stringify({ projectId: PROJECT_ID }),
	});
	return (await created.json()).conversationId;
}

function sendMessage(convId: string, body: Record<string, unknown>) {
	return app.request(`/api/v1/assistant/conversations/${convId}/messages`, {
		method: "POST", headers: auth(), body: JSON.stringify(body),
	});
}

beforeAll(async () => {
	networkId = (await createNetwork("credits-int-network")).id;
	const now = new Date();
	const { id: serverKeyId, hash } = await generateServerKey();
	await db.insert(serverKeys).values({ id: serverKeyId, hash, networkId, createdAt: now }).onConflictDoNothing();
	await db.insert(projects).values({
		id: PROJECT_ID, networkId, serverKeyId, name: "Credits Int",
		hash: "", filesJson: "{}", createdAt: now, updatedAt: now,
	}).onConflictDoNothing();
	await db.insert(users).values({
		id: USER_ID, email: "credits-int@example.com", name: "Credits Int", createdAt: now, updatedAt: now,
	}).onConflictDoNothing();
	await db.insert(memberships).values({
		id: "mem_credits_int", userId: USER_ID, networkId, role: "owner", createdAt: now,
	}).onConflictDoNothing();
	userSessionId = (await createSession(USER_ID)).id;
	defaultModel = await createModel({
		displayName: "Default Int", description: "", badge: "balanced",
		provider: "openai", providerModelId: "default-int",
		creditsPerMInput: 1000, creditsPerMOutput: 2000,
		realUsdPerMInput: 0, realUsdPerMOutput: 0, isActive: true,
	});
	altModel = await createModel({
		displayName: "Alt Int", description: "", badge: "cheap",
		provider: "openai", providerModelId: "alt-int",
		creditsPerMInput: 10, creditsPerMOutput: 20,
		realUsdPerMInput: 0, realUsdPerMOutput: 0, isActive: true,
	});
	await setDefaultModel(defaultModel.id);
	__setProviderForTests(usageProvider());
});

afterAll(async () => {
	__setProviderForTests(null);
	await db.delete(appSettings).where(eq(appSettings.key, AI_SETTINGS_KEY));
	await db.delete(aiModels);
	await db.delete(users).where(eq(users.id, USER_ID));
	await db.delete(networks).where(eq(networks.id, networkId)); // cascades serverKeys, projects, usage, ledger
});

describe("assistant credits integration", () => {
	it("zero balance → 402 insufficient_credits, no turn, no usage row", async () => {
		const convId = await openConversation();
		const res = await sendMessage(convId, { text: "hi" });
		expect(res.status).toBe(402);
		expect((await res.json()).error).toBe("insufficient_credits");
		const rows = await db.select().from(aiUsageLog).where(eq(aiUsageLog.networkId, networkId));
		expect(rows.length).toBe(0);
	});

	it("successful turn: usage log + ledger debit + SSE credits event", async () => {
		await grantCredits({ networkId, amount: 1000 });
		const convId = await openConversation();
		const res = await sendMessage(convId, { text: "make something" });
		expect(res.status).toBe(200);
		const sse = await res.text();
		expect(sse).toContain("event: credits");
		expect(sse).toContain('"debited":700');
		expect(sse).toContain('"balance":300');
		expect(await getBalance(networkId)).toBe(300);
		const [log] = await db.select().from(aiUsageLog).where(eq(aiUsageLog.networkId, networkId));
		expect(log.status).toBe("success");
		expect(log.modelName).toBe("Default Int");
		expect(log.conversationId).toBe(convId);
		expect(log.promptPreview).toBe("make something");
		expect(log.userId).toBe(USER_ID); // user: session actor
		expect(log.serverKeyId).toBeNull();
	});

	it("body.modelId picks the requested model (snapshot in the log)", async () => {
		const convId = await openConversation();
		const res = await sendMessage(convId, { text: "cheap please", modelId: altModel.id });
		expect(res.status).toBe(200);
		await res.text();
		const rows = await db.select().from(aiUsageLog).where(eq(aiUsageLog.networkId, networkId));
		const log = rows.find((r) => r.modelName === "Alt Int");
		expect(log).toBeTruthy();
		// alt prices: ceil((500k·10 + 100k·20)/1M) = 7
		expect(log?.creditsCharged).toBe(7);
	});

	it("provider error → status=error, tokens logged, balance untouched", async () => {
		__setProviderForTests(throwingProvider());
		try {
			const before = await getBalance(networkId);
			const convId = await openConversation();
			const res = await sendMessage(convId, { text: "boom" });
			expect(res.status).toBe(200); // SSE already started
			const sse = await res.text();
			expect(sse).toContain("event: error");
			expect(sse).not.toContain("event: credits");
			expect(await getBalance(networkId)).toBe(before);
			const rows = await db.select().from(aiUsageLog).where(eq(aiUsageLog.networkId, networkId));
			const errLog = rows.find((r) => r.status === "error");
			expect(errLog?.inputTokens).toBe(9000);
			expect(errLog?.creditsCharged).toBe(0);
		} finally {
			__setProviderForTests(usageProvider());
		}
	});

	it("maxCreditsPerTurn stops the loop and still debits the consumed usage", async () => {
		await setSetting(AI_SETTINGS_KEY, { creditUsdMicroRate: 10_000, maxCreditsPerTurn: 100 }, null);
		const before = await getBalance(networkId);
		const convId = await openConversation();
		const res = await sendMessage(convId, { text: "expensive" });
		const sse = await res.text();
		expect(sse).toContain("turn_budget_exceeded");
		expect(sse).toContain("event: credits");
		expect(await getBalance(networkId)).toBe(before - 700); // one usage event consumed
	});

	it("unknown project at conversation creation → 404 project_not_found", async () => {
		const created = await app.request("/api/v1/assistant/conversations", {
			method: "POST", headers: auth(), body: JSON.stringify({ projectId: "ghost_project" }),
		});
		expect(created.status).toBe(404);
		expect((await created.json()).error).toBe("project_not_found");
	});

	it("user without membership cannot open a conversation on the project", async () => {
		const now = new Date();
		await db.insert(users).values({
			id: "usr_credits_outsider", email: "credits-outsider@example.com", name: "Out",
			createdAt: now, updatedAt: now,
		}).onConflictDoNothing();
		const outsiderSession = (await createSession("usr_credits_outsider")).id;
		try {
			const res = await app.request("/api/v1/assistant/conversations", {
				method: "POST",
				headers: { Cookie: `artisan_user_session=${outsiderSession}`, "Content-Type": "application/json" },
				body: JSON.stringify({ projectId: PROJECT_ID }),
			});
			expect(res.status).toBe(403);
			expect((await res.json()).error).toBe("forbidden");
		} finally {
			await db.delete(users).where(eq(users.id, "usr_credits_outsider"));
		}
	});

	it("member of a different network cannot open a conversation on this project", async () => {
		const now = new Date();
		const otherNetwork = await createNetwork("credits-int-other-network");
		const { id: otherServerKeyId, hash: otherHash } = await generateServerKey();
		await db.insert(serverKeys).values({ id: otherServerKeyId, hash: otherHash, networkId: otherNetwork.id, createdAt: now }).onConflictDoNothing();
		await db.insert(projects).values({
			id: "proj_credits_other", networkId: otherNetwork.id, serverKeyId: otherServerKeyId,
			name: "Other", hash: "", filesJson: "{}", createdAt: now, updatedAt: now,
		}).onConflictDoNothing();
		try {
			const res = await app.request("/api/v1/assistant/conversations", {
				method: "POST", headers: auth(), body: JSON.stringify({ projectId: "proj_credits_other" }),
			});
			expect(res.status).toBe(403);
		} finally {
			await db.delete(networks).where(eq(networks.id, otherNetwork.id));
		}
	});
});
