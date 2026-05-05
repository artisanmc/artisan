import { describe, expect, it } from "vitest";
import { evaluate } from "../evaluator";
import { parse } from "../parser";
import { Scope } from "../scope";
import fixtures from "./expr-fixtures.json";

interface Fixture {
  name: string;
  expr: string;
  scope: Record<string, unknown>;
  expected: unknown;
}

describe("expression fixtures", () => {
  for (const fx of fixtures as Fixture[]) {
    it(fx.name, () => {
      const ast = parse(fx.expr);
      const result = evaluate(ast, new Scope(fx.scope));
      if (fx.expected === null) {
        expect(result === null || result === undefined).toBe(true);
      } else {
        expect(result).toEqual(fx.expected);
      }
    });
  }
});
