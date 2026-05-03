import { describe, expect, it } from "vitest";
import type { AstNode } from "./ast";
import { ParseError } from "./errors";
import { parse } from "./parser";

const stripPos = <T>(node: T): T => {
  if (node === null || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (k === "pos") continue;
    out[k] = Array.isArray(v) ? v.map((x) => stripPos(x as unknown)) : stripPos(v);
  }
  return out as T;
};

describe("parse — basics", () => {
  it("parses a number literal", () => {
    expect(stripPos(parse("42"))).toEqual({ kind: "literal", value: 42 });
  });

  it("parses a string literal", () => {
    expect(stripPos(parse(`"hi"`))).toEqual({ kind: "literal", value: "hi" });
  });

  it("parses true / false / null", () => {
    expect(stripPos(parse("true"))).toEqual({ kind: "literal", value: true });
    expect(stripPos(parse("false"))).toEqual({ kind: "literal", value: false });
    expect(stripPos(parse("null"))).toEqual({ kind: "literal", value: null });
  });

  it("parses an identifier", () => {
    expect(stripPos(parse("foo"))).toEqual({ kind: "identifier", name: "foo" });
  });

  it("parses a PAPI token", () => {
    expect(stripPos(parse("%player_name%"))).toEqual({
      kind: "papi",
      placeholder: "player_name",
    });
  });

  it("parses parens transparently", () => {
    expect(stripPos(parse("(42)"))).toEqual({ kind: "literal", value: 42 });
  });

  it("rejects empty input", () => {
    expect(() => parse("")).toThrow(ParseError);
  });

  it("rejects trailing tokens", () => {
    expect(() => parse("42 43")).toThrow(ParseError);
  });

  it("rejects unmatched paren", () => {
    expect(() => parse("(42")).toThrow(ParseError);
  });
});

describe("parse — path access", () => {
  it("parses a dot field access", () => {
    expect(stripPos(parse("a.b"))).toEqual({
      kind: "path",
      target: { kind: "identifier", name: "a" },
      field: "b",
    });
  });

  it("parses a chain of dot accesses", () => {
    expect(stripPos(parse("a.b.c"))).toEqual({
      kind: "path",
      target: {
        kind: "path",
        target: { kind: "identifier", name: "a" },
        field: "b",
      },
      field: "c",
    });
  });

  it("parses an index access with literal", () => {
    expect(stripPos(parse("arr[0]"))).toEqual({
      kind: "index",
      target: { kind: "identifier", name: "arr" },
      index: { kind: "literal", value: 0 },
    });
  });

  it("parses an index access with expression", () => {
    expect(stripPos(parse("arr[i]"))).toEqual({
      kind: "index",
      target: { kind: "identifier", name: "arr" },
      index: { kind: "identifier", name: "i" },
    });
  });

  it("parses a method call without args", () => {
    expect(stripPos(parse("xs.length()"))).toEqual({
      kind: "method",
      target: { kind: "identifier", name: "xs" },
      method: "length",
      args: [],
    });
  });

  it("parses a method call with args", () => {
    expect(stripPos(parse(`xs.join(", ")`))).toEqual({
      kind: "method",
      target: { kind: "identifier", name: "xs" },
      method: "join",
      args: [{ kind: "literal", value: ", " }],
    });
  });

  it("treats trailing dot-id followed by lparen as a method call", () => {
    const node = parse("a.b.c(1)");
    expect(stripPos(node)).toEqual({
      kind: "method",
      target: {
        kind: "path",
        target: { kind: "identifier", name: "a" },
        field: "b",
      },
      method: "c",
      args: [{ kind: "literal", value: 1 }],
    });
  });
});
