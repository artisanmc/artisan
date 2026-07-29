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
      { kind: "action", action: { type: "broadcast", text: { key: "hi {player}" } } },
    ]);
    expect(printFromSteps(steps)).toBe('broadcast "hi {player}"');
  });

  it("@key maps to an @-prefixed LText key, reversibly", () => {
    const steps = parseToSteps("broadcast @shop.vip");
    expect(steps).toEqual([
      { kind: "action", action: { type: "broadcast", text: { key: "@shop.vip" } } },
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

// ADR yaml-assisted-editing ④ : une action de data source PEUT référencer une
// clé i18n — le plugin la résout désormais dans les lang/ du project. La clé
// est explicite (jamais dérivée d'une position), donc elle doit survivre au
// round-trip sans être confondue avec un littéral.
describe("actions de data source — clés i18n explicites", () => {
  it("préserve @clé et distingue le littéral", () => {
    const dsl = 'send_message @shop.bought\nsend_message "merci !"';
    const steps = parseToSteps(dsl);
    expect(steps).toEqual([
      { kind: "action", action: { type: "send_message", text: { key: "@shop.bought" } } },
      { kind: "action", action: { type: "send_message", text: { key: "merci !" } } },
    ]);
    // Le littéral repart entre guillemets, la référence sans — sinon le runtime
    // afficherait « @shop.bought » au joueur, ou chercherait une clé « merci ! ».
    expect(printFromSteps(steps)).toBe(dsl);
  });
});
