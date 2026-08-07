import { describe, expect, it } from "vitest";
import { resolveI18n } from "./i18n";

describe("resolveI18n", () => {
  it("returns the input when no {i18n:...} tokens are present", () => {
    expect(resolveI18n("hello", { lookup: () => undefined })).toBe("hello");
  });

  it("substitutes a single token", () => {
    expect(
      resolveI18n("Hello {i18n:greeting}", {
        lookup: (k) => (k === "greeting" ? "world" : undefined),
      }),
    ).toBe("Hello world");
  });

  it("substitutes recursively", () => {
    const dict: Record<string, string> = {
      a: "outer {i18n:b} done",
      b: "inner",
    };
    expect(resolveI18n("{i18n:a}", { lookup: (k) => dict[k] })).toBe("outer inner done");
  });

  it("inserts a marker on cycle", () => {
    const dict: Record<string, string> = {
      a: "{i18n:b}",
      b: "{i18n:a}",
    };
    const out = resolveI18n("{i18n:a}", { lookup: (k) => dict[k] });
    expect(out).toContain("⚠️");
    expect(out).toContain("cycle");
  });

  it("inserts a marker on depth exceeded", () => {
    const dict: Record<string, string> = {};
    for (let n = 0; n < 10; n++) dict[`k${n}`] = `{i18n:k${n + 1}}`;
    const out = resolveI18n("{i18n:k0}", { lookup: (k) => dict[k] });
    expect(out).toContain("⚠️");
    expect(out).toContain("depth");
  });

  // ADR `expression-parity` §4: a missing key keeps its source visible rather
  // than erasing the text, same rule as an unbound identifier.
  it("keeps the source visible for a missing key", () => {
    expect(resolveI18n("{i18n:nope}", { lookup: () => undefined })).toBe("{i18n:nope}");
  });

  it("preserves expressions and PAPI tokens around i18n substitutions", () => {
    expect(
      resolveI18n("a {i18n:x} {y} %z%", { lookup: (k) => (k === "x" ? "X" : undefined) }),
    ).toBe("a X {y} %z%");
  });
});
