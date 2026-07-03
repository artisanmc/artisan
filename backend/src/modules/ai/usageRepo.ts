import { db } from "../../db/index";
import { aiUsageLog } from "../../db/schema";
import type { LlmUsage } from "../assistant/provider/types";
import { debitBuckets, getBalance } from "./creditsRepo";
import type { AiModel } from "./modelRepo";
import { computeCreditsCharged, computeRealCostMicroUsd } from "./pricing";

export interface UsageInput {
	networkId: string;
	userId?: string | null;
	serverKeyId?: string | null;
	model: AiModel;
	actionType?: string;
	conversationId?: string | null;
	usage: LlmUsage;
	durationMs?: number | null;
	promptPreview: string;
}

function baseRow(input: UsageInput, id: string, now: Date) {
	return {
		id,
		networkId: input.networkId,
		userId: input.userId ?? null,
		serverKeyId: input.serverKeyId ?? null,
		modelId: input.model.id,
		modelName: input.model.displayName,
		provider: input.model.provider,
		providerModelId: input.model.providerModelId,
		actionType: input.actionType ?? "chat",
		conversationId: input.conversationId ?? null,
		inputTokens: input.usage.inputTokens,
		outputTokens: input.usage.outputTokens,
		cachedInputTokens: input.usage.cachedInputTokens ?? 0,
		realCostMicroUsd: computeRealCostMicroUsd(input.usage, input.model),
		durationMs: input.durationMs ?? null,
		promptPreview: input.promptPreview.slice(0, 200),
		createdAt: now,
	};
}

/** Success turn: usage log + ledger debit, one transaction. */
export async function recordDebitedTurn(
	input: UsageInput,
): Promise<{ usageLogId: string; debited: number; balance: number }> {
	const credits = computeCreditsCharged(input.usage, input.model);
	const id = crypto.randomUUID();
	const now = new Date();
	await db.transaction(async (tx) => {
		await tx.insert(aiUsageLog).values({
			...baseRow(input, id, now),
			creditsCharged: credits,
			status: "success",
		});
		if (credits > 0) {
			await debitBuckets(tx, input.networkId, credits, { usageLogId: id, now });
		}
	});
	return { usageLogId: id, debited: credits, balance: await getBalance(input.networkId) };
}

/** Provider error: consumed tokens logged for admin visibility — NEVER debited. */
export async function recordErrorTurn(
	input: UsageInput & { errorMessage: string },
): Promise<string> {
	const id = crypto.randomUUID();
	await db.insert(aiUsageLog).values({
		...baseRow(input, id, new Date()),
		creditsCharged: 0,
		status: "error",
		errorMessage: input.errorMessage,
	});
	return id;
}
