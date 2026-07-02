import type { LlmUsage } from "../assistant/provider/types";
import type { AiModel } from "./modelRepo";

/** Credits owed for a turn's summed usage. ceil → any non-zero usage costs ≥ 1.
 *  Cached input tokens are INCLUDED in inputTokens by the provider (OpenAI
 *  semantics) — no separate cache pricing in V1. */
export function computeCreditsCharged(u: LlmUsage, m: AiModel): number {
	const raw = u.inputTokens * m.creditsPerMInput + u.outputTokens * m.creditsPerMOutput;
	return raw === 0 ? 0 : Math.ceil(raw / 1_000_000);
}

/** Real provider cost in micro-USD (analytics only — rounded, not billed). */
export function computeRealCostMicroUsd(u: LlmUsage, m: AiModel): number {
	return Math.round(
		(u.inputTokens * m.realUsdPerMInput + u.outputTokens * m.realUsdPerMOutput) / 1_000_000,
	);
}

/** Sum the usage events of one turn (one event per provider round-trip). */
export function sumUsage(events: LlmUsage[]): LlmUsage {
	return events.reduce<LlmUsage>(
		(acc, u) => ({
			inputTokens: acc.inputTokens + u.inputTokens,
			outputTokens: acc.outputTokens + u.outputTokens,
			cachedInputTokens: (acc.cachedInputTokens ?? 0) + (u.cachedInputTokens ?? 0),
		}),
		{ inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 },
	);
}
