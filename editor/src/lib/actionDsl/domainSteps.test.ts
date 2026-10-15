import { describe, expect, it } from "vitest";
import { dslStepsToSteps, parseToSteps, printFromSteps, stepsToDslSteps } from "./domainSteps";
import { parseActionDsl } from "./parser";

/**
 * Adapter contract: DSL string ↔ domain Step[] round-trips, and the `@`-prefix
 * encoding keeps literal vs i18n-ref distinct across the domain LText (which is
 * a bare {key}). Cf. ADR `action-dsl`.
 */
describe("action DSL ↔ domain steps adapter", () => {
  it("literal text maps to a verbatim LText key", () => {
    const steps = parseToSteps('broadcast "hi {player}"');
    expect(steps).toEqual([
      { kind: "action", action: { name: "broadcast", value: { key: "hi {player}" } } },
    ]);
    expect(printFromSteps(steps)).toBe('broadcast "hi {player}"');
  });

  it("@key maps to an @-prefixed LText key, reversibly", () => {
    const steps = parseToSteps("broadcast @shop.vip");
    expect(steps).toEqual([
      { kind: "action", action: { name: "broadcast", value: { key: "@shop.vip" } } },
    ]);
    expect(printFromSteps(steps)).toBe("broadcast @shop.vip");
  });

  it("round-trips if/else with typed conditions through the domain", () => {
    const dsl = 'if has_permission(vip):\n  give_money 100\nelse:\n  send_message "no"';
    expect(printFromSteps(parseToSteps(dsl))).toBe(dsl);
  });

  it("dslStepsToSteps ∘ stepsToDslSteps is identity on the DSL AST", () => {
    const ast = parseActionDsl("if has_permission(a) and random_chance(0.5):\n  broadcast @x");
    expect(stepsToDslSteps(dslStepsToSteps(ast))).toEqual(ast);
  });

  it("empty string ↔ no steps", () => {
    expect(parseToSteps("")).toEqual([]);
    expect(printFromSteps([])).toBe("");
  });
});

// ADR yaml-assisted-editing ④: a data source action MAY reference an i18n
// key — the plugin now resolves it in the project's lang/. The key is
// explicit (never derived from a position), so it must survive the round
// trip without being mistaken for a literal.
describe("data source actions — explicit i18n keys", () => {
  it("preserves @key and tells the literal apart", () => {
    const dsl = 'send_message @shop.bought\nsend_message "merci !"';
    const steps = parseToSteps(dsl);
    expect(steps).toEqual([
      { kind: "action", action: { name: "send_message", value: { key: "@shop.bought" } } },
      { kind: "action", action: { name: "send_message", value: { key: "merci !" } } },
    ]);
    // The literal goes back quoted, the reference unquoted — otherwise the runtime
    // would show "@shop.bought" to the player, or look up a key "merci !".
    expect(printFromSteps(steps)).toBe(dsl);
  });
});
