import { describe, expect, it } from "vitest";
import { evaluate } from "./evaluator";
import { parse } from "./parser";
import { Scope } from "./scope";

const evalSrc = (src: string, scope: Scope) => evaluate(parse(src), scope);

describe("evaluator — literals and identifiers", () => {
  const empty = new Scope({});

  it("evaluates a number literal", () => {
    expect(evalSrc("42", empty)).toBe(42);
  });

  it("evaluates a string literal", () => {
    expect(evalSrc(`"hi"`, empty)).toBe("hi");
  });

  it("evaluates true/false/null", () => {
    expect(evalSrc("true", empty)).toBe(true);
    expect(evalSrc("null", empty)).toBeNull();
  });

  it("looks up an identifier", () => {
    const s = new Scope({ x: 7 });
    expect(evalSrc("x", s)).toBe(7);
  });

  it("returns undefined for unknown identifier", () => {
    expect(evalSrc("missing", empty)).toBeUndefined();
  });
});

describe("evaluator — path access", () => {
  it("walks a dotted path", () => {
    const s = new Scope({ quest: { name: "kill", reward: { gold: 100 } } });
    expect(evalSrc("quest.name", s)).toBe("kill");
    expect(evalSrc("quest.reward.gold", s)).toBe(100);
  });

  it("returns undefined for missing field", () => {
    const s = new Scope({ quest: { name: "kill" } });
    expect(evalSrc("quest.unknown", s)).toBeUndefined();
  });

  it("safe-navigates through null/undefined", () => {
    const s = new Scope({ quest: null });
    expect(evalSrc("quest.name", s)).toBeUndefined();
  });
});

describe("evaluator — index access", () => {
  it("indexes an array with literal", () => {
    const s = new Scope({ xs: ["a", "b", "c"] });
    expect(evalSrc("xs[1]", s)).toBe("b");
  });

  it("indexes with computed index", () => {
    const s = new Scope({ xs: ["a", "b", "c"], i: 2 });
    expect(evalSrc("xs[i]", s)).toBe("c");
  });

  it("returns undefined for out of bounds", () => {
    const s = new Scope({ xs: ["a"] });
    expect(evalSrc("xs[5]", s)).toBeUndefined();
  });
});

describe("evaluator — PAPI", () => {
  it("calls the papi resolver", () => {
    const s = new Scope({}, { papi: (k) => (k === "player_name" ? "Steve" : "") });
    expect(evalSrc("%player_name%", s)).toBe("Steve");
  });
});
