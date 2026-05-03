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
