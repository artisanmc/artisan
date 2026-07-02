import { and, desc, eq, gte, lt, lte, or, sql } from "drizzle-orm";
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

export interface UsageLogFilters {
	userId?: string;
	modelId?: string;
	provider?: string;
	actionType?: string;
	status?: string;
	from?: Date;
	to?: Date;
}

export type UsageLogDto = Omit<typeof aiUsageLog.$inferSelect, "createdAt"> & { createdAt: string };

function filterConds(f: UsageLogFilters) {
	const conds = [];
	if (f.userId) conds.push(eq(aiUsageLog.userId, f.userId));
	if (f.modelId) conds.push(eq(aiUsageLog.modelId, f.modelId));
	if (f.provider) conds.push(eq(aiUsageLog.provider, f.provider));
	if (f.actionType) conds.push(eq(aiUsageLog.actionType, f.actionType));
	if (f.status) conds.push(eq(aiUsageLog.status, f.status));
	if (f.from) conds.push(gte(aiUsageLog.createdAt, f.from));
	if (f.to) conds.push(lte(aiUsageLog.createdAt, f.to));
	return conds;
}

export async function listUsageLogs(
	filters: UsageLogFilters,
	cursor?: string,
	limit = 50,
): Promise<{ logs: UsageLogDto[]; nextCursor: string | null }> {
	const conds = filterConds(filters);
	if (cursor) {
		const sep = cursor.indexOf("_");
		// No separator = malformed cursor → ignore it (first page) instead of
		// letting slice(0, -1) fabricate a bogus (at, id) pair.
		if (sep > 0) {
			const ms = Number(cursor.slice(0, sep));
			const id = cursor.slice(sep + 1);
			if (!Number.isNaN(ms) && id) {
				const at = new Date(ms);
				conds.push(
					or(
						lt(aiUsageLog.createdAt, at),
						and(eq(aiUsageLog.createdAt, at), lt(aiUsageLog.id, id)),
					)!,
				);
			}
		}
	}
	const rows = await db
		.select()
		.from(aiUsageLog)
		.where(conds.length > 0 ? and(...conds) : undefined)
		.orderBy(desc(aiUsageLog.createdAt), desc(aiUsageLog.id))
		.limit(limit + 1);
	const page = rows.slice(0, limit);
	const last = page[page.length - 1];
	return {
		logs: page.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
		nextCursor: rows.length > limit && last ? `${last.createdAt.getTime()}_${last.id}` : null,
	};
}

const CSV_COLUMNS = [
	"id", "createdAt", "networkId", "userId", "serverKeyId", "modelName", "provider",
	"providerModelId", "actionType", "status", "inputTokens", "outputTokens",
	"cachedInputTokens", "creditsCharged", "realCostMicroUsd", "durationMs",
	"errorMessage", "promptPreview",
] as const;

function csvCell(v: unknown): string {
	if (v === null || v === undefined) return "";
	const s = String(v);
	return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

/** Filtered export, hard-capped at 10k rows (silent truncation would lie —
 *  the cap is documented in the admin UI). */
export async function usageLogsCsv(filters: UsageLogFilters): Promise<string> {
	const { logs } = await listUsageLogs(filters, undefined, 10_000);
	const lines = [CSV_COLUMNS.join(",")];
	for (const l of logs) {
		lines.push(CSV_COLUMNS.map((c) => csvCell((l as Record<string, unknown>)[c])).join(","));
	}
	return lines.join("\n");
}
