import { describe, expect, it } from "vitest";
import { tokenizeTemplate } from "./tokenizer";

describe("tokenizeTemplate", () => {
  it("returns a single literal segment when there are no braces", () => {
    expect(tokenizeTemplate("hello world")).toEqual([
      { kind: "literal", text: "hello world" },
    ]);
  });

  it("splits literal + expression", () => {
    expect(tokenizeTemplate("Hi {name}!")).toEqual([
      { kind: "literal", text: "Hi " },
      { kind: "expression", text: "name" },
      { kind: "literal", text: "!" },
    ]);
  });

  it("matches braces handling parens and quoted strings inside", () => {
    expect(tokenizeTemplate(`{xs.join(", ")}`)).toEqual([
      { kind: "expression", text: `xs.join(", ")` },
    ]);
  });

  it("handles {} at start and end", () => {
    expect(tokenizeTemplate("{a}+{b}")).toEqual([
      { kind: "expression", text: "a" },
      { kind: "literal", text: "+" },
      { kind: "expression", text: "b" },
    ]);
  });

  it("handles braces inside string literals (does not close early)", () => {
    expect(tokenizeTemplate(`{a == "}" ? 1 : 2}`)).toEqual([
      { kind: "expression", text: `a == "}" ? 1 : 2` },
    ]);
  });

  it("treats {i18n:key} as a special literal token (passthrough)", () => {
    expect(tokenizeTemplate("a {i18n:foo} b")).toEqual([
      { kind: "literal", text: "a " },
      { kind: "i18n", text: "foo" },
      { kind: "literal", text: " b" },
    ]);
  });

  it("treats unmatched opening brace as literal", () => {
    expect(tokenizeTemplate("hello {name no-close")).toEqual([
      { kind: "literal", text: "hello {name no-close" },
    ]);
  });

  it("treats {} (empty) as literal", () => {
    expect(tokenizeTemplate("a{}b")).toEqual([
      { kind: "literal", text: "a{}b" },
    ]);
  });
});
