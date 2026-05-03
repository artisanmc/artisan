import { describe, expect, it } from "vitest";
import { computeExpressionPreview } from "./ExpressionPreview";

describe("computeExpressionPreview", () => {
  it("returns null for empty input", () => {
    expect(computeExpressionPreview("")).toBeNull();
    expect(computeExpressionPreview("   ")).toBeNull();
  });

  it("returns parse-error state on invalid syntax", () => {
    expect(computeExpressionPreview("a !! b")).toEqual({
      kind: "parseError",
      message: expect.stringContaining("Unexpected token"),
    });
  });

  it("returns ok state with the evaluated string for a literal", () => {
    expect(computeExpressionPreview("42")).toEqual({ kind: "ok", display: "42" });
  });

  it("returns ok state with quotes preserved for string literals", () => {
    expect(computeExpressionPreview('"hello"')).toEqual({ kind: "ok", display: "hello" });
  });

  it("evaluates ternary against empty scope", () => {
    expect(computeExpressionPreview("true ? 1 : 2")).toEqual({ kind: "ok", display: "1" });
  });

  it("renders undefined identifiers as empty string", () => {
    expect(computeExpressionPreview("x")).toEqual({ kind: "ok", display: "" });
  });

  it("evaluates a comparison to its boolean result", () => {
    expect(computeExpressionPreview("5 > 3")).toEqual({ kind: "ok", display: "true" });
  });

  it("evaluates list method calls if the operand resolves", () => {
    expect(computeExpressionPreview("xs.length()")).toEqual({ kind: "ok", display: "0" });
  });
});
