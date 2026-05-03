import { describe, expect, it } from "vitest";
import { COMPARISON_OPS, serializeComparison, tryParseAsComparison } from "./tryParseAsComparison";

describe("tryParseAsComparison", () => {
  it("detects a simple == comparison between identifiers", () => {
    expect(tryParseAsComparison('quest.tag == "weapon"')).toEqual({
      left: "quest.tag",
      op: "==",
      right: '"weapon"',
    });
  });

  it("detects each of the 6 comparison operators", () => {
    for (const op of ["==", "!=", "<", "<=", ">", ">="] as const) {
      expect(tryParseAsComparison(`a ${op} b`)).toEqual({ left: "a", op, right: "b" });
    }
  });

  it("returns null for ternary expressions", () => {
    expect(tryParseAsComparison("a > b ? 1 : 2")).toBeNull();
  });

  it("returns null for &&/|| expressions", () => {
    expect(tryParseAsComparison("a > b && c < d")).toBeNull();
  });

  it("returns null for arithmetic-only expressions (no compare op at root)", () => {
    expect(tryParseAsComparison("a + b")).toBeNull();
  });

  it("returns null for unparseable / empty input", () => {
    expect(tryParseAsComparison("")).toBeNull();
    expect(tryParseAsComparison("not !valid syntax @@")).toBeNull();
  });

  it("handles paths with dots and method calls on either side", () => {
    expect(tryParseAsComparison("quest.tags.length() > 0")).toEqual({
      left: "quest.tags.length()",
      op: ">",
      right: "0",
    });
  });

  it("preserves quoted-string literals in the right operand", () => {
    expect(tryParseAsComparison('%player_world% == "lobby"')).toEqual({
      left: "%player_world%",
      op: "==",
      right: '"lobby"',
    });
  });
});

describe("serializeComparison", () => {
  it("joins parts with spaces around the operator", () => {
    expect(serializeComparison({ left: "a", op: "==", right: "b" })).toBe("a == b");
  });

  it("returns empty string when any part is empty (caller's job to validate before save)", () => {
    expect(serializeComparison({ left: "", op: "==", right: "b" })).toBe("");
    expect(serializeComparison({ left: "a", op: "==", right: "" })).toBe("");
  });
});

describe("COMPARISON_OPS constant", () => {
  it("lists all 6 comparison operators", () => {
    expect(COMPARISON_OPS).toEqual(["==", "!=", "<", "<=", ">", ">="]);
  });
});
