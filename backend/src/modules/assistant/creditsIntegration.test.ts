import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { app } from "../../app";
import { db } from "../../db/index";
import {
	aiCreditLedger,
	aiModels,
	aiUsageLog,
	appSettings,
	editorSessions,
	networks,
	projects,
	serverKeys,
} from "../../db/schema";
import { createNetwork } from "../../lib/networkManager";
import { getBalance, grantCredits } from "../ai/creditsRepo";
import { createModel, setDefaultModel, type AiModel } from "../ai/modelRepo";
import { AI_SETTINGS_KEY } from "../ai/settings";
import { setSetting } from "../../lib/appSettings";
import type { LlmProvider } from "./provider/types";
import { __setProviderForTests } from "./routes";

const SRV = "srv_credits_int";
const ACCESS = "acc_credits_int";
const PROJECT_ID = "proj_credits_int";
let networkId = "";
let defaultModel: AiModel;
let altModel: AiModel;

const auth = { Authorization: `Bearer ${ACCESS}`, "Content-Type": "application/json" };

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
		method: "POST", headers: auth, body: JSON.stringify({ packId: PROJECT_ID }),
	});
	return (await created.json()).conversationId;
}

function sendMessage(convId: string, body: Record<string, unknown>) {
	return app.request(`/api/v1/assistant/conversations/${convId}/messages`, {
		method: "POST", headers: auth, body: JSON.stringify(body),
	});
}

beforeAll(async () => {
	networkId = (await createNetwork("credits-int-network")).id;
	const now = new Date();
	const future = new Date(Date.now() + 3_600_000);
	await db.insert(serverKeys).values({ id: SRV, hash: "h_credits_int", networkId, createdAt: now }).onConflictDoNothing();
	await db.insert(editorSessions).values({
		token: "url_credits_int", serverKeyId: SRV, createdBy: "CONSOLE",
		createdAt: now, expiresAt: future, accessToken: ACCESS, accessExpiresAt: future,
	}).onConflictDoNothing();
	await db.insert(projects).values({
		id: PROJECT_ID, networkId, serverKeyId: SRV, name: "Credits Int",
		hash: "", filesJson: "{}", createdAt: now, updatedAt: now,
	}).onConflictDoNothing();
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
	await db.delete(editorSessions).where(eq(editorSessions.token, "url_credits_int"));
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
		expect(log.userId).toBeNull();
		expect(log.serverKeyId).toBe(SRV); // sk: session actor
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

	it("unknown project on the conversation → 404 project_not_found", async () => {
		const created = await app.request("/api/v1/assistant/conversations", {
			method: "POST", headers: auth, body: JSON.stringify({ packId: "ghost_project" }),
		});
		const { conversationId } = await created.json();
		const res = await sendMessage(conversationId, { text: "hi" });
		expect(res.status).toBe(404);
		expect((await res.json()).error).toBe("project_not_found");
	});
});
