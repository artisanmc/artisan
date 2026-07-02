import { and, gte, lte, sql } from "drizzle-orm";
import { db } from "../../db/index";
import { aiUsageLog } from "../../db/schema";
import { getAiSettings } from "./settings";

const sums = {
	inputTokens: sql<number>`coalesce(sum(${aiUsageLog.inputTokens}), 0)::int`,
	outputTokens: sql<number>`coalesce(sum(${aiUsageLog.outputTokens}), 0)::int`,
	creditsCharged: sql<number>`coalesce(sum(${aiUsageLog.creditsCharged}), 0)::int`,
	realCostMicroUsd: sql<number>`coalesce(sum(${aiUsageLog.realCostMicroUsd}), 0)::int`,
	turns: sql<number>`count(*)::int`,
};

export interface UsageSummary {
	totals: {
		inputTokens: number; outputTokens: number; cachedInputTokens: number;
		creditsCharged: number; realCostMicroUsd: number; marginMicroUsd: number;
		turns: number; errors: number;
	};
	byModel: ({ modelId: string | null; modelName: string; provider: string } & SumRow)[];
	byProvider: ({ provider: string } & SumRow)[];
	daily: ({ date: string } & SumRow)[];
}
type SumRow = { inputTokens: number; outputTokens: number; creditsCharged: number; realCostMicroUsd: number; turns: number };

export async function usageSummary(from: Date, to: Date): Promise<UsageSummary> {
	const range = and(gte(aiUsageLog.createdAt, from), lte(aiUsageLog.createdAt, to));

	const [totals] = await db
		.select({
			...sums,
			cachedInputTokens: sql<number>`coalesce(sum(${aiUsageLog.cachedInputTokens}), 0)::int`,
			errors: sql<number>`count(*) filter (where ${aiUsageLog.status} = 'error')::int`,
		})
		.from(aiUsageLog)
		.where(range);

	const byModel = await db
		.select({ modelId: aiUsageLog.modelId, modelName: aiUsageLog.modelName, provider: aiUsageLog.provider, ...sums })
		.from(aiUsageLog)
		.where(range)
		.groupBy(aiUsageLog.modelId, aiUsageLog.modelName, aiUsageLog.provider);

	const byProvider = await db
		.select({ provider: aiUsageLog.provider, ...sums })
		.from(aiUsageLog)
		.where(range)
		.groupBy(aiUsageLog.provider);

	const day = sql<string>`to_char(date_trunc('day', ${aiUsageLog.createdAt}), 'YYYY-MM-DD')`;
	const daily = await db
		.select({ date: day, ...sums })
		.from(aiUsageLog)
		.where(range)
		.groupBy(day)
		.orderBy(day);

	const settings = await getAiSettings();
	return {
		totals: {
			...totals,
			marginMicroUsd: totals.creditsCharged * settings.creditUsdMicroRate - totals.realCostMicroUsd,
		},
		byModel,
		byProvider,
		daily,
	};
}
