import { describe, expect, it } from "vitest";
import { pricingSignupUrl, safeAuthReturn } from "./authReturn";

describe("authentication return", () => {
  it.each(["https://evil.test", "//evil.test", "/\\evil.test", "/\nevil.test", null])(
    "rejects unsafe next %s",
    (value) => {
      expect(safeAuthReturn(value)).toBe("/account");
    },
  );
  it("preserves the selected offer as a local path through signup", () => {
    const href = new URL(pricingSignupUrl("plan&one"), "http://local");
    expect(safeAuthReturn(href.searchParams.get("next"))).toBe("/pricing?plan=plan%26one");
  });
});
