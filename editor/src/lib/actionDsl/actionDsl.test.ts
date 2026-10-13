import { describe, expect, it } from "vitest";
import type { DslStep } from "./ast";
// Shared cross-stack conformance contract (mirrored by the Kotlin suite).
import fixtures from "../../../../testdata/action-dsl-conformance.json";
import { parseActionDsl, printActionDsl } from "./index";

/**
 * Conformance suite for the Action DSL codec — the executable contract shared
 * (eventually) with the Kotlin implementation. Cf. ADR `action-dsl`. Each
 * fixture asserts: parse(dsl) → ast, print(ast) → canonicalDsl, and the
 * round-trip parse(canonicalDsl) → ast → canonicalDsl is stable.
 */

interface Fixture {
  name: string;
  dsl: string;
  canonicalDsl: string;
  ast: DslStep[];
}

describe("action DSL codec", () => {
  for (const fx of fixtures as Fixture[]) {
    it(`parses — ${fx.name}`, () => {
      expect(parseActionDsl(fx.dsl)).toEqual(fx.ast);
    });
    it(`prints canonical — ${fx.name}`, () => {
      expect(printActionDsl(fx.ast)).toBe(fx.canonicalDsl);
    });
    it(`round-trips — ${fx.name}`, () => {
      const ast = parseActionDsl(fx.canonicalDsl);
      expect(ast).toEqual(fx.ast);
      expect(printActionDsl(ast)).toBe(fx.canonicalDsl);
    });
  }

  it("reads project:id refs as one token, and still opens blocks with a trailing colon", () => {
    expect(parseActionDsl("open_menu 2024:main")).toEqual([
      { kind: "action", action: { type: "open_menu", menuId: "2024:main" } },
    ]);
    const [step] = parseActionDsl("if world_is(shop):\n  open_menu shop:main");
    expect(step?.kind).toBe("if");
    expect(() => parseActionDsl("open_menu :main")).toThrow();
    expect(() => parseActionDsl("open_menu shop:")).toThrow();
  });

  it("empty source parses to no steps", () => {
    expect(parseActionDsl("")).toEqual([]);
    expect(parseActionDsl("\n  # just a comment\n")).toEqual([]);
  });
});
