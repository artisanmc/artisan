import { describe, expect, it } from "vitest";
import { formatCredits, formatTokens, formatUsdFromMicro } from "./format";

describe("format", () => {
  it("formatCredits groups thousands", () => {
    expect(formatCredits(1250, "en")).toBe("1,250");
    expect(formatCredits(0, "en")).toBe("0");
  });
  it("formatUsdFromMicro renders 2-decimal USD", () => {
    // 6_000_000 µ$ = $6.00
    expect(formatUsdFromMicro(6_000_000, "en")).toBe("$6.00");
    // 75_000 µ$ = $0.08 (rounded)
    expect(formatUsdFromMicro(75_000, "en")).toBe("$0.08");
    // negative margin
    expect(formatUsdFromMicro(-500_000, "en")).toBe("-$0.50");
  });
  it("formatTokens groups thousands", () => {
    expect(formatTokens(1_000_000, "en")).toBe("1,000,000");
  });
});
