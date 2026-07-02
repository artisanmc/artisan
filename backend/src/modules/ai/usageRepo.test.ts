import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../../db/index";
import { aiCreditLedger, aiModels, aiUsageLog, networks } from "../../db/schema";
import { createNetwork } from "../../lib/networkManager";
import { getBalance, grantCredits } from "./creditsRepo";
import { createModel, type AiModel } from "./modelRepo";
import { recordDebitedTurn, recordErrorTurn } from "./usageRepo";

let networkId = "";
let model: AiModel;

beforeAll(async () => {
	networkId = (await createNetwork("usage-test-network")).id;
	model = await createModel({
		displayName: "Meter Test", description: "", badge: "balanced",
		provider: "openai", providerModelId: "gpt-meter",
		creditsPerMInput: 1000, creditsPerMOutput: 2000,
		realUsdPerMInput: 3_000_000, realUsdPerMOutput: 15_000_000, isActive: true,
	});
	await grantCredits({ networkId, amount: 1000 });
});

afterAll(async () => {
	await db.delete(aiUsageLog).where(eq(aiUsageLog.networkId, networkId));
	await db.delete(aiCreditLedger).where(eq(aiCreditLedger.networkId, networkId));
	await db.delete(networks).where(eq(networks.id, networkId));
	await db.delete(aiModels).where(eq(aiModels.id, model.id));
});

describe("recordDebitedTurn", () => {
	it("writes usage log + linked ledger debit; balance drops", async () => {
		const res = await recordDebitedTurn({
			networkId, userId: null, serverKeyId: null, model,
			conversationId: "conv1",
			usage: { inputTokens: 500_000, outputTokens: 100_000, cachedInputTokens: 50_000 },
			durationMs: 1234,
			promptPreview: "x".repeat(500), // must be truncated to 200
		});
		expect(res.debited).toBe(700); // ceil((500k·1000 + 100k·2000)/1M)
		expect(res.balance).toBe(300);
		const [log] = await db.select().from(aiUsageLog).where(eq(aiUsageLog.id, res.usageLogId));
		expect(log.status).toBe("success");
		expect(log.creditsCharged).toBe(700);
		expect(log.modelName).toBe("Meter Test"); // snapshot
		expect(log.cachedInputTokens).toBe(50_000);
		expect(log.promptPreview.length).toBe(200);
		const [debit] = await db.select().from(aiCreditLedger)
			.where(eq(aiCreditLedger.usageLogId, res.usageLogId));
		expect(debit.delta).toBe(-700);
		expect(debit.reason).toBe("debit");
	});

	it("zero usage → usage log but NO ledger row", async () => {
		const before = await getBalance(networkId);
		const res = await recordDebitedTurn({
			networkId, model, usage: { inputTokens: 0, outputTokens: 0 }, promptPreview: "",
		});
		expect(res.debited).toBe(0);
		expect(res.balance).toBe(before);
		const rows = await db.select().from(aiCreditLedger)
			.where(eq(aiCreditLedger.usageLogId, res.usageLogId));
		expect(rows.length).toBe(0);
	});
});

describe("recordErrorTurn", () => {
	it("logs consumed tokens with status=error and never debits", async () => {
		const before = await getBalance(networkId);
		const id = await recordErrorTurn({
			networkId, model, usage: { inputTokens: 9000, outputTokens: 10 },
			promptPreview: "boom", errorMessage: "provider exploded",
		});
		const [log] = await db.select().from(aiUsageLog).where(eq(aiUsageLog.id, id));
		expect(log.status).toBe("error");
		expect(log.errorMessage).toBe("provider exploded");
		expect(log.inputTokens).toBe(9000);
		expect(log.creditsCharged).toBe(0);
		expect(await getBalance(networkId)).toBe(before);
	});
});
