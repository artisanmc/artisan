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

describe("evaluator — list methods", () => {
  it(".join(sep) joins with separator", () => {
    const s = new Scope({ xs: ["a", "b", "c"] });
    expect(evalSrc(`xs.join(", ")`, s)).toBe("a, b, c");
  });

  it(".length returns the array length", () => {
    const s = new Scope({ xs: ["a", "b", "c"] });
    expect(evalSrc("xs.length()", s)).toBe(3);
  });

  it(".first / .last return endpoints", () => {
    const s = new Scope({ xs: ["a", "b", "c"] });
    expect(evalSrc("xs.first()", s)).toBe("a");
    expect(evalSrc("xs.last()", s)).toBe("c");
  });

  it(".at(n) indexes (alias of [n])", () => {
    const s = new Scope({ xs: ["a", "b", "c"] });
    expect(evalSrc("xs.at(1)", s)).toBe("b");
  });

  it(".contains(x) checks membership", () => {
    const s = new Scope({ xs: ["a", "b", "c"] });
    expect(evalSrc(`xs.contains("b")`, s)).toBe(true);
    expect(evalSrc(`xs.contains("z")`, s)).toBe(false);
  });

  it(".length on null returns 0", () => {
    expect(evalSrc("xs.length()", new Scope({ xs: null }))).toBe(0);
  });

  it(".join on null returns ''", () => {
    expect(evalSrc(`xs.join(",")`, new Scope({ xs: null }))).toBe("");
  });

  it(".first on empty returns null", () => {
    expect(evalSrc("xs.first()", new Scope({ xs: [] }))).toBeNull();
  });

  it(".join on a non-array returns '' and does not throw", () => {
    expect(evalSrc(`xs.join(",")`, new Scope({ xs: 42 }))).toBe("");
  });

  it(".pluck extracts a field from each object", () => {
    const s = new Scope({
      ranks: [
        { name: "VIP", price: 10 },
        { name: "MVP", price: 50 },
      ],
    });
    expect(evalSrc(`ranks.pluck("name")`, s)).toEqual(["VIP", "MVP"]);
  });

  it(".pluck chained with .join", () => {
    const s = new Scope({ ranks: [{ name: "VIP" }, { name: "MVP" }] });
    expect(evalSrc(`ranks.pluck("name").join(", ")`, s)).toBe("VIP, MVP");
  });

  it(".pluck returns null for missing field", () => {
    const s = new Scope({ xs: [{ a: 1 }, { b: 2 }] });
    expect(evalSrc(`xs.pluck("a")`, s)).toEqual([1, null]);
  });

  it(".pluck on non-array returns []", () => {
    expect(evalSrc(`xs.pluck("name")`, new Scope({ xs: 42 }))).toEqual([]);
  });
});

describe("evaluator — operators", () => {
  const empty = new Scope({});

  it("unary not", () => {
    expect(evalSrc("!true", empty)).toBe(false);
    expect(evalSrc("!0", empty)).toBe(true);
    expect(evalSrc("!null", empty)).toBe(true);
  });

  it("addition: number + number", () => {
    expect(evalSrc("2 + 3", empty)).toBe(5);
  });

  it("addition: string + anything = concat (JS-style)", () => {
    expect(evalSrc(`"abc" + 1`, empty)).toBe("abc1");
    expect(evalSrc(`1 + "abc"`, empty)).toBe("1abc");
  });

  it("subtraction: number - number", () => {
    expect(evalSrc("10 - 4", empty)).toBe(6);
  });

  it("subtraction: string - anything returns null (warn)", () => {
    expect(evalSrc(`"abc" - 1`, empty)).toBeNull();
  });

  it("compare: numeric coercion", () => {
    const s = new Scope({}, { papi: (k) => (k === "x" ? "10" : "") });
    expect(evalSrc("%x% > 5", s)).toBe(true);
    expect(evalSrc("%x% < 5", s)).toBe(false);
  });

  it("eq: null == empty string", () => {
    expect(evalSrc(`null == ""`, empty)).toBe(true);
  });

  it("eq: null != 0", () => {
    expect(evalSrc("null == 0", empty)).toBe(false);
  });

  it("&& short-circuits", () => {
    let called = false;
    const s = new Scope({
      a: false,
      get b() {
        called = true;
        return true;
      },
    });
    evalSrc("a && b", s);
    expect(called).toBe(false);
  });

  it("|| short-circuits", () => {
    let called = false;
    const s = new Scope({
      a: true,
      get b() {
        called = true;
        return true;
      },
    });
    evalSrc("a || b", s);
    expect(called).toBe(false);
  });

  it("ternary picks branch by truthy condition", () => {
    expect(evalSrc(`true ? "yes" : "no"`, empty)).toBe("yes");
    expect(evalSrc(`false ? "yes" : "no"`, empty)).toBe("no");
    expect(evalSrc(`null ? "yes" : "no"`, empty)).toBe("no");
  });
});
