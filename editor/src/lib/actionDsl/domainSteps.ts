import type { Action, I18nKey, LText, Project, Step } from "@/domain/types";
import { getText } from "@/lib/i18n";
import type { DslAction, DslStep, DslText } from "./ast";
import { parseActionDsl } from "./parser";
import { printActionDsl } from "./printer";

/**
 * Editor adapter: DSL AST ({@link DslStep}) ↔ domain {@link Step}. Cf. ADR
 * `action-dsl`. The domain carries action text as an `LText` (`{key}`), which
 * cannot itself distinguish an inline literal from an `@key` reference — so the
 * conversion between {@link DslText} and {@link LText} is injected.
 *
 * Two conventions live on top of the same structural mapping:
 *  - **Data-source** (the `@`-prefix default): a reference becomes `@<key>`, a
 *    literal stays verbatim (the `literalSteps` convention). Used where action
 *    text is a literal disk value, not a registered Key site.
 *  - **Project-aware** ({@link stepsToDsl}/{@link dslToSteps}): menu / command /
 *    dialog action text IS a registered Key site, so an `LText` whose key is in
 *    `Project.i18nKeys` serializes as `@key`; anything else falls back to a
 *    literal (resolved via `getText`). This is what Phase 2 uses.
 */

const REF_PREFIX = "@";

/** DSL text → domain LText. */
export type TextToLText = (t: DslText) => LText;
/** Domain LText → DSL text. */
export type LTextToText = (l: LText) => DslText;

const defaultTextToLText: TextToLText = (t) => ({
  key: ("lit" in t ? t.lit : REF_PREFIX + t.ref) as I18nKey,
});

const defaultLTextToText: LTextToText = (l) => {
  const k = String(l.key);
  return k.startsWith(REF_PREFIX) ? { ref: k.slice(1) } : { lit: k };
};

function dslActionToAction(a: DslAction, toLText: TextToLText): Action {
  switch (a.type) {
    case "send_message":
      return { type: "send_message", text: toLText(a.text) };
    case "broadcast":
      return { type: "broadcast", text: toLText(a.text) };
    case "show_title":
      return {
        type: "show_title",
        title: toLText(a.title),
        ...(a.subtitle ? { subtitle: toLText(a.subtitle) } : {}),
        ...(a.fadeIn !== undefined ? { fadeIn: a.fadeIn } : {}),
        ...(a.stay !== undefined ? { stay: a.stay } : {}),
        ...(a.fadeOut !== undefined ? { fadeOut: a.fadeOut } : {}),
      };
    default:
      return a; // non-text actions are already domain Actions
  }
}

function actionToDslAction(a: Action, toText: LTextToText): DslAction {
  switch (a.type) {
    case "send_message":
      return { type: "send_message", text: toText(a.text) };
    case "broadcast":
      return { type: "broadcast", text: toText(a.text) };
    case "show_title":
      return {
        type: "show_title",
        title: toText(a.title),
        ...(a.subtitle ? { subtitle: toText(a.subtitle) } : {}),
        ...(a.fadeIn !== undefined ? { fadeIn: a.fadeIn } : {}),
        ...(a.stay !== undefined ? { stay: a.stay } : {}),
        ...(a.fadeOut !== undefined ? { fadeOut: a.fadeOut } : {}),
      };
    default:
      return a;
  }
}

export function dslStepsToSteps(steps: DslStep[], toLText: TextToLText = defaultTextToLText): Step[] {
  return steps.map((s) =>
    s.kind === "action"
      ? { kind: "action", action: dslActionToAction(s.action, toLText) }
      : {
          kind: "if",
          cases: s.cases.map((c) => ({
            conditions: c.conditions,
            ...(c.joins ? { joins: c.joins } : {}),
            steps: dslStepsToSteps(c.steps, toLText),
          })),
          ...(s.else ? { else: dslStepsToSteps(s.else, toLText) } : {}),
        },
  );
}

export function stepsToDslSteps(steps: Step[], toText: LTextToText = defaultLTextToText): DslStep[] {
  return steps.map((s) =>
    s.kind === "action"
      ? { kind: "action", action: actionToDslAction(s.action, toText) }
      : {
          kind: "if",
          cases: s.cases.map((c) => ({
            conditions: c.conditions,
            ...(c.joins ? { joins: c.joins } : {}),
            steps: stepsToDslSteps(c.steps, toText),
          })),
          ...(s.else ? { else: stepsToDslSteps(s.else, toText) } : {}),
        },
  );
}

/** Raw DSL string → domain steps (data-source `@`-convention). Throws on parse error. */
export function parseToSteps(dsl: string, toLText: TextToLText = defaultTextToLText): Step[] {
  return dslStepsToSteps(parseActionDsl(dsl), toLText);
}

/** Domain steps → canonical DSL string (data-source `@`-convention). */
export function printFromSteps(steps: Step[], toText: LTextToText = defaultLTextToText): string {
  return printActionDsl(stepsToDslSteps(steps, toText));
}

// ─── Project-aware conversions (Phase 2: menu / command / dialog) ─────────────

/**
 * Domain Step[] → DSL string, resolving each action `LText` against the
 * Project: a key registered in `project.i18nKeys` serializes as `@key` (a Key-site
 * reference), anything else as a `"literal"` (default-language text). Cf. ADR
 * `action-dsl` Phase 2.
 *
 * In `inline` i18n mode there are no `@key` refs at all: every text is the
 * default language's literal, and the plugin re-derives the canonical address
 * of each one to look up the other languages.
 */
export function stepsToDsl(steps: Step[], project: Project): string {
  const toText: LTextToText = (l) =>
    project.i18nMode !== "inline" && String(l.key) in project.i18nKeys
      ? { ref: String(l.key) }
      : { lit: getText(project, l, project.defaultLang) };
  return printActionDsl(stepsToDslSteps(steps, toText));
}

/**
 * DSL string → domain Step[], the inverse of {@link stepsToDsl}: `@key` maps to
 * `LText{key}`, a literal maps to a verbatim `LText{key: literal}` (the
 * `literalSteps` convention — no key minting, read-only contexts). Import paths
 * that need to mint/register keys use the converter callbacks instead. Empty /
 * blank input yields no steps.
 */
export function dslToSteps(dsl: string, _pack: Project): Step[] {
  if (!dsl || dsl.trim() === "") return [];
  return dslStepsToSteps(parseActionDsl(dsl), defaultTextToLText);
}
