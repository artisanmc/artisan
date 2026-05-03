import { describe, expect, it } from "vitest";
import { ParseError } from "./errors";
import { tokenize } from "./lexer";

describe("tokenize", () => {
  it("emits eof on empty input", () => {
    const t = tokenize("");
    expect(t).toEqual([{ kind: "eof", text: "", pos: 0 }]);
  });

  it("tokenizes a number literal", () => {
    const t = tokenize("42");
    expect(t[0]).toEqual({ kind: "number", text: "42", value: 42, pos: 0 });
    expect(t[1]!.kind).toBe("eof");
  });

  it("tokenizes a decimal", () => {
    expect(tokenize("3.14")[0]!.value).toBe(3.14);
  });

  it("tokenizes a double-quoted string with escapes", () => {
    const [t] = tokenize(`"hi\\n"`);
    expect(t!).toEqual({ kind: "string", text: `"hi\\n"`, value: "hi\n", pos: 0 });
  });

  it("tokenizes a single-quoted string", () => {
    expect(tokenize("'foo'")[0]!.value).toBe("foo");
  });

  it("tokenizes identifiers", () => {
    expect(tokenize("foo_bar")[0]!).toEqual({
      kind: "identifier",
      text: "foo_bar",
      pos: 0,
    });
  });

  it("recognizes true / false / null as keyword tokens", () => {
    expect(tokenize("true")[0]!.kind).toBe("true");
    expect(tokenize("false")[0]!.kind).toBe("false");
    expect(tokenize("null")[0]!.kind).toBe("null");
  });

  it("tokenizes a PAPI placeholder", () => {
    expect(tokenize("%player_name%")[0]!).toEqual({
      kind: "papi",
      text: "%player_name%",
      value: "player_name",
      pos: 0,
    });
  });

  it("tokenizes operators in greedy fashion", () => {
    expect(tokenize("==")[0]!.kind).toBe("eq");
    expect(tokenize("!=")[0]!.kind).toBe("neq");
    expect(tokenize("<=")[0]!.kind).toBe("lte");
    expect(tokenize(">=")[0]!.kind).toBe("gte");
    expect(tokenize("&&")[0]!.kind).toBe("and");
    expect(tokenize("||")[0]!.kind).toBe("or");
    expect(tokenize("<")[0]!.kind).toBe("lt");
    expect(tokenize(">")[0]!.kind).toBe("gt");
    expect(tokenize("!")[0]!.kind).toBe("bang");
  });

  it("tokenizes punctuation", () => {
    const kinds = tokenize("(),.[]?:").map((t) => t.kind);
    expect(kinds).toEqual([
      "lparen",
      "rparen",
      "comma",
      "dot",
      "lbracket",
      "rbracket",
      "question",
      "colon",
      "eof",
    ]);
  });

  it("skips whitespace", () => {
    expect(tokenize("  42   foo  ").map((t) => t.kind)).toEqual(["number", "identifier", "eof"]);
  });

  it("tokenizes a complex expression", () => {
    const t = tokenize(`quest.tags.join(", ")`);
    expect(t.map((x) => x.kind)).toEqual([
      "identifier", // quest
      "dot",
      "identifier", // tags
      "dot",
      "identifier", // join
      "lparen",
      "string",
      "rparen",
      "eof",
    ]);
  });

  it("preserves source positions", () => {
    const [a, , c] = tokenize("a + b");
    expect(a!.pos).toBe(0);
    expect(c!.pos).toBe(4);
  });

  it("throws ParseError on unterminated string", () => {
    expect(() => tokenize(`"hello`)).toThrow(ParseError);
  });

  it("throws ParseError on unterminated PAPI placeholder", () => {
    expect(() => tokenize("%player_name")).toThrow(ParseError);
  });

  it("throws ParseError on unknown character", () => {
    expect(() => tokenize("foo @ bar")).toThrow(ParseError);
  });
});
