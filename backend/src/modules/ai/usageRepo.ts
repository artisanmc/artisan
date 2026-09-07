import { eq } from "drizzle-orm";
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
	const result = await db.transaction((tx) =>
		recordDebitedTurnInTransaction(tx, input),
	);
	return { ...result, balance: await getBalance(input.networkId) };
}

/** Caller owns the transaction: a migration checkpoint and its debit commit together. */
export async function recordDebitedTurnInTransaction(
	tx: typeof db,
	input: UsageInput,
	options: { idempotencyKey?: string } = {},
): Promise<{ usageLogId: string; debited: number }> {
	const credits = computeCreditsCharged(input.usage, input.model);
	const id = crypto.randomUUID();
	const now = new Date();
	const inserted = await tx
		.insert(aiUsageLog)
		.values({
			...baseRow(input, id, now),
			idempotencyKey: options.idempotencyKey ?? null,
			creditsCharged: credits,
			status: "success",
		})
		.onConflictDoNothing()
		.returning({ id: aiUsageLog.id });
	if (!inserted.length) {
		if (!options.idempotencyKey) throw new Error("usage_conflict");
		const [existing] = await tx
			.select()
			.from(aiUsageLog)
			.where(eq(aiUsageLog.idempotencyKey, options.idempotencyKey));
		if (
			!existing ||
			existing.networkId !== input.networkId ||
			existing.modelId !== input.model.id ||
			existing.conversationId !== (input.conversationId ?? null)
		)
			throw new Error("usage_conflict");
		return { usageLogId: existing.id, debited: existing.creditsCharged };
	}
	if (credits > 0)
		await debitBuckets(tx, input.networkId, credits, { usageLogId: id, now });
	return { usageLogId: id, debited: credits };
}

/** Provider error: consumed tokens logged for admin visibility — NEVER debited. */
export async function recordErrorTurn(
	input: UsageInput & { errorMessage: string },
): Promise<string> {
	return recordErrorTurnInTransaction(db, input);
}

export async function recordErrorTurnInTransaction(
	tx: typeof db,
	input: UsageInput & { errorMessage: string },
	idempotencyKey?: string,
): Promise<string> {
	const id = crypto.randomUUID();
	const inserted = await tx
		.insert(aiUsageLog)
		.values({
			...baseRow(input, id, new Date()),
			idempotencyKey: idempotencyKey ?? null,
			creditsCharged: 0,
			status: "error",
			errorMessage: input.errorMessage,
		})
		.onConflictDoNothing()
		.returning({ id: aiUsageLog.id });
	if (inserted.length) return id;
	if (!idempotencyKey) throw new Error("usage_conflict");
	const [existing] = await tx
		.select()
		.from(aiUsageLog)
		.where(eq(aiUsageLog.idempotencyKey, idempotencyKey));
	if (
		!existing ||
		existing.networkId !== input.networkId ||
		existing.modelId !== input.model.id
	)
		throw new Error("usage_conflict");
	return existing.id;
}
