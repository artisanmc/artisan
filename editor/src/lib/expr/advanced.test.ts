import { describe, expect, it } from "vitest";

import { isAdvancedExpression } from "./advanced";

describe("isAdvancedExpression", () => {
  it("leaves reading values and comparisons free", () => {
    for (const src of [
      "player.name",
      "%player_name%",
      "player.coins > 5",
      "!a && b == 'x'",
      "a[0].b",
    ]) {
      expect(isAdvancedExpression(src)).toBe(false);
    }
  });

  it("marks methods, arithmetic and ternaries", () => {
    for (const src of [
      "player.name.upper()",
      "player.coins + 10",
      "a > 1 ? 'x' : 'y'",
      "!(a - 1 > 0)",
    ]) {
      expect(isAdvancedExpression(src)).toBe(true);
    }
  });

  it("is not advanced when it does not parse", () => {
    expect(isAdvancedExpression("a +")).toBe(false);
  });
});
