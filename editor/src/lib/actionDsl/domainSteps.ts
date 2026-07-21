import type { Action, I18nKey, LText, Step } from "@/domain/types";
import type { DslAction, DslStep, DslText } from "./ast";
import { parseActionDsl } from "./parser";
import { printActionDsl } from "./printer";

/**
 * Editor adapter: DSL AST ({@link DslStep}) ↔ domain {@link Step}. Cf. ADR
 * `action-dsl`. The domain carries action text as an `LText` (`{key}`), which
 * cannot itself distinguish an inline literal from an `@key` reference — so we
 * encode the distinction reversibly in the key: a reference becomes `@<key>`, a
 * literal stays verbatim (the `literalSteps` convention). This lets the existing
 * `ControlledStepsEditor` (which edits `LText.key` as literal text) round-trip
 * DSL values losslessly: typing `@shop.vip` in a text field reads back as a
 * ref. Full i18n Key-site registration for refs is deferred (Phase 1 stores the
 * DSL string opaque). `parseToSteps` / `printFromSteps` bridge the raw string.
 */

const REF_PREFIX = "@";

function textToLText(t: DslText): LText {
  return { key: ("lit" in t ? t.lit : REF_PREFIX + t.ref) as I18nKey };
}

function ltextToText(l: LText): DslText {
  const k = String(l.key);
  return k.startsWith(REF_PREFIX) ? { ref: k.slice(1) } : { lit: k };
}

function dslActionToAction(a: DslAction): Action {
  switch (a.type) {
    case "send_message":
      return { type: "send_message", text: textToLText(a.text) };
    case "broadcast":
      return { type: "broadcast", text: textToLText(a.text) };
    case "show_title":
      return {
        type: "show_title",
        title: textToLText(a.title),
        ...(a.subtitle ? { subtitle: textToLText(a.subtitle) } : {}),
        ...(a.fadeIn !== undefined ? { fadeIn: a.fadeIn } : {}),
        ...(a.stay !== undefined ? { stay: a.stay } : {}),
        ...(a.fadeOut !== undefined ? { fadeOut: a.fadeOut } : {}),
      };
    default:
      return a; // non-text actions are already domain Actions
  }
}

function actionToDslAction(a: Action): DslAction {
  switch (a.type) {
    case "send_message":
      return { type: "send_message", text: ltextToText(a.text) };
    case "broadcast":
      return { type: "broadcast", text: ltextToText(a.text) };
    case "show_title":
      return {
        type: "show_title",
        title: ltextToText(a.title),
        ...(a.subtitle ? { subtitle: ltextToText(a.subtitle) } : {}),
        ...(a.fadeIn !== undefined ? { fadeIn: a.fadeIn } : {}),
        ...(a.stay !== undefined ? { stay: a.stay } : {}),
        ...(a.fadeOut !== undefined ? { fadeOut: a.fadeOut } : {}),
      };
    default:
      return a;
  }
}

export function dslStepsToSteps(steps: DslStep[]): Step[] {
  return steps.map((s) =>
    s.kind === "action"
      ? { kind: "action", action: dslActionToAction(s.action) }
      : {
          kind: "if",
          cases: s.cases.map((c) => ({
            conditions: c.conditions,
            ...(c.joins ? { joins: c.joins } : {}),
            steps: dslStepsToSteps(c.steps),
          })),
          ...(s.else ? { else: dslStepsToSteps(s.else) } : {}),
        },
  );
}

export function stepsToDslSteps(steps: Step[]): DslStep[] {
  return steps.map((s) =>
    s.kind === "action"
      ? { kind: "action", action: actionToDslAction(s.action) }
      : {
          kind: "if",
          cases: s.cases.map((c) => ({
            conditions: c.conditions,
            ...(c.joins ? { joins: c.joins } : {}),
            steps: stepsToDslSteps(c.steps),
          })),
          ...(s.else ? { else: stepsToDslSteps(s.else) } : {}),
        },
  );
}

/** Raw DSL string → domain steps (for the visual editor). Throws on parse error. */
export function parseToSteps(dsl: string): Step[] {
  return dslStepsToSteps(parseActionDsl(dsl));
}

/** Domain steps → canonical DSL string. */
export function printFromSteps(steps: Step[]): string {
  return printActionDsl(stepsToDslSteps(steps));
}
