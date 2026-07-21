import { describe, expect, it } from "vitest";
// Shared cross-stack conformance vector (mirrored by the Kotlin
// `LeafEvalConformanceTest`). Proves the Kotlin leaf evaluator agrees with the
// TS `lib/expr` engine on the boolean result of every expression.
import fixtures from "../../../../testdata/action-dsl-eval-conformance.json";
import { toBoolean } from "../expr/coercion";
import { evaluate } from "../expr/evaluator";
import { parse } from "../expr/parser";
import { Scope } from "../expr/scope";

interface EvalFixture {
  name: string;
  expr: string;
  scope: Record<string, unknown>;
  expected: boolean;
}

/**
 * Leaf expression evaluator conformance (ADR `action-dsl` §6). Each fixture's
 * `expr` is evaluated through the existing `lib/expr` pipeline (parse →
 * evaluate against the scope) and coerced to boolean — the same boolean the
 * Kotlin `evalLeaf` must produce. `lib/expr` is authoritative on coercion.
 */
describe("action DSL leaf evaluator conformance", () => {
  for (const fx of fixtures as EvalFixture[]) {
    it(`${fx.name} — ${fx.expr}`, () => {
      const scope = new Scope(fx.scope);
      const value = evaluate(parse(fx.expr), scope);
      expect(toBoolean(value)).toBe(fx.expected);
    });
  }
});
