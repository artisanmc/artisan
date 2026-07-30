import { describe, expect, it } from "vitest";
import { parse, stringify } from "yaml";
import fixtures from "../../../testdata/lang-tree-conformance.json";
import { flattenLangTree, nestLangTree } from "./langTree";

// The fixture's per-case shapes widen to a union of literal types — narrow them
// back to the codec's signature.
const cases = fixtures.cases as Array<{
  name: string;
  flat: Record<string, string>;
  nested: Record<string, unknown>;
}>;
const readOnlyCases = fixtures.readOnlyCases as unknown as Array<{
  name: string;
  tree: unknown;
  flat: Record<string, string>;
}>;

describe("langTree — cross-stack vector", () => {
  for (const c of cases) {
    it(`nests and flattens '${c.name}'`, () => {
      expect(nestLangTree(c.flat)).toEqual(c.nested);
      expect(flattenLangTree(c.nested)).toEqual(c.flat);
    });
  }

  for (const c of readOnlyCases) {
    it(`reads tolerantly: '${c.name}'`, () => {
      expect(flattenLangTree(c.tree)).toEqual(c.flat);
    });
  }
});

describe("langTree", () => {
  it("survives a YAML round-trip (quoting of ambiguous keys and values)", () => {
    const flat = {
      "menus.m.elements.item:ci_ab12.default.lore": "zzza",
      "data.rows.1.name": "",
      "data.rows.2.name": "true",
      "data.rows.3.name": "1.21",
      "menus.m.title": "line1\nline2",
    };
    expect(flattenLangTree(parse(stringify(nestLangTree(flat))))).toEqual(flat);
  });

  it("coerces YAML integer keys to string segments", () => {
    expect(flattenLangTree(parse("data:\n  rows:\n    1:\n      name: Blocs\n"))).toEqual({
      "data.rows.1.name": "Blocs",
    });
  });

  it("emits levels in byte order, deterministically", () => {
    expect(stringify(nestLangTree({ "m.b": "2", "m.a": "1", z: "3", "a.c.d": "4" }))).toBe(
      stringify(nestLangTree({ z: "3", "a.c.d": "4", "m.a": "1", "m.b": "2" })),
    );
    expect(Object.keys(nestLangTree({ "m.b": "2", "m.a": "1", z: "3" }))).toEqual(["m", "z"]);
    expect(Object.keys(nestLangTree({ "m.b": "2", "m.a": "1" }).m as object)).toEqual(["a", "b"]);
  });

  it("keeps an empty segment addressable", () => {
    expect(flattenLangTree(nestLangTree({ "a..b": "x" }))).toEqual({ "a..b": "x" });
  });

  it("is a fixed point over repeated nesting", () => {
    const flat = { "a.b.c": "x", "a.b": "y", "a.d": "z" };
    const once = nestLangTree(flat);
    expect(nestLangTree(flattenLangTree(once))).toEqual(once);
  });
});
