import { describe, expect, it } from "vitest";
import { suggestCreditsPerM } from "./creditPricing";

describe("suggestCreditsPerM", () => {
  it("converts a real µUSD price into credits, margin applied", () => {
    // $3 / 1M tokens, 1 credit = $0.01, +100% margin → $6 → 600 credits
    expect(suggestCreditsPerM(3_000_000, 10_000, 100)).toBe(600);
    expect(suggestCreditsPerM(3_000_000, 10_000, 0)).toBe(300);
    expect(suggestCreditsPerM(3_000_000, 10_000, 50)).toBe(450);
  });

  it("rounds up so a priced model never bills zero", () => {
    expect(suggestCreditsPerM(1, 10_000, 0)).toBe(1);
  });

  it("returns 0 for a free model", () => {
    expect(suggestCreditsPerM(0, 10_000, 100)).toBe(0);
  });

  it("returns null when the credit rate is unusable", () => {
    expect(suggestCreditsPerM(3_000_000, 0, 100)).toBeNull();
    expect(suggestCreditsPerM(3_000_000, Number.NaN, 100)).toBeNull();
  });
});
