import { describe, expect, it } from "bun:test";
import type { AiModel } from "./modelRepo";
import { computeCreditsCharged, computeRealCostMicroUsd, sumUsage } from "./pricing";

const model = {
	creditsPerMInput: 1000,
	creditsPerMOutput: 2000,
	realUsdPerMInput: 3_000_000, // $3 / 1M
	realUsdPerMOutput: 15_000_000, // $15 / 1M
} as AiModel;

describe("computeCreditsCharged", () => {
	it("0 usage → 0 credits (never bill an empty turn)", () => {
		expect(computeCreditsCharged({ inputTokens: 0, outputTokens: 0 }, model)).toBe(0);
	});
	it("ceils so any non-zero usage costs at least 1 credit", () => {
		expect(computeCreditsCharged({ inputTokens: 100, outputTokens: 0 }, model)).toBe(1);
	});
	it("exact formula: ceil((in·cpmIn + out·cpmOut) / 1M)", () => {
		// 500k·1000 + 100k·2000 = 700_000_000_000... /1M → 700
		expect(
			computeCreditsCharged({ inputTokens: 500_000, outputTokens: 100_000 }, model),
		).toBe(700);
	});
});

describe("computeRealCostMicroUsd", () => {
	it("rounds micro-USD", () => {
		// 1M in → $3 = 3_000_000 µ$; 200k out → $3 = 3_000_000 µ$
		expect(
			computeRealCostMicroUsd({ inputTokens: 1_000_000, outputTokens: 200_000 }, model),
		).toBe(6_000_000);
	});
});

describe("sumUsage", () => {
	it("sums including optional cachedInputTokens", () => {
		expect(
			sumUsage([
				{ inputTokens: 10, outputTokens: 5, cachedInputTokens: 3 },
				{ inputTokens: 20, outputTokens: 1 },
			]),
		).toEqual({ inputTokens: 30, outputTokens: 6, cachedInputTokens: 3 });
	});
});
