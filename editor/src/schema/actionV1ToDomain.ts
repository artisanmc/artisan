import type {
  Action as DomainAction,
  Condition as DomainCondition,
  Step as DomainStep,
  DialogId,
  ElementId,
  LText,
  MenuId,
} from "@/domain/types";
import type { DslText } from "@/lib/actionDsl";
import { dslStepsToSteps, parseActionDsl } from "@/lib/actionDsl";
import {
  conditionFromStructured,
  structuredToSteps,
  type ActionTextCodec,
} from "@/lib/actions/structuredSteps";

// The menu/v1 wire object is parsed YAML (snake_case, loosely typed). We model
// it as a bag and reconcile each field explicitly into the domain shapes.
// biome-ignore lint/suspicious/noExplicitAny: untyped wire object — fields read by snake name
type Json = Record<string, any>;

export interface ConverterCtx {
  text: (raw: string | Record<string, string> | undefined) => LText;
  ref: (key: string) => LText;
  pushUnsupported: (s: string) => void;
}

const DOMAIN_CONDITIONS = new Set([
  "has_permission",
  "has_money",
  "placeholder_equals",
  "placeholder_match",
  "has_item",
  "has_xp",
  "has_level",
  "world_is",
  "time_is",
  "random_chance",
  "cooldown_passed",
  "player_in_region",
  "pagination_at_first",
  "pagination_at_last",
  "not",
  "and",
  "or",
  "expression",
]);

export interface StepConverter {
  condition: (c: Json) => DomainCondition | null;
  /**
   * Parse an Action DSL string (menu/command/dialog click-handler wire, ADR
   * `action-dsl`) into domain steps. `@key` → registered LText ref (translation
   * pulled from `ctx.ref`); a `"literal"` → a freshly-minted key (`ctx.text`).
   * Blank/unparseable input → `[]` (recorded as unsupported).
   */
  steps: (dsl: unknown) => DomainStep[];
  /**
   * Legacy STRUCTURED wire → domain (the `{kind, action|cases}` tree). Kept for
   * the module-data literal-steps path (`@/lib/literalSteps`), which serializes
   * to structured maps — NOT the menu/command/dialog DSL wire. Do not use for
   * menu/v1 import (that is now the DSL `steps` above).
   */
  action: (a: Json) => DomainAction | null;
  step: (s: Json) => DomainStep | null;
  ifArray: (
    arr: Json[] | undefined,
  ) => { conds: DomainCondition[]; joins: ("and" | "or")[] } | undefined;
}

export function makeStepConverter(ctx: ConverterCtx): StepConverter {
  const { text, ref, pushUnsupported } = ctx;

  // Conditions (explicit per-type mapping; NOT pass-through)
  function condition(c: Json): DomainCondition | null {
    if (!c || typeof c !== "object") {
      pushUnsupported("condition: <invalid>");
      return null;
    }
    // Keyed structured condition (no `type` discriminant) — ADR structured-action-wire.
    if (typeof c.type !== "string") return conditionFromStructured(c);
    if (!DOMAIN_CONDITIONS.has(c.type)) {
      pushUnsupported(`condition: ${c.type}`);
      return null;
    }
    switch (c.type) {
      case "has_permission":
        return { type: "has_permission", perm: c.perm };
      case "has_money":
        return { type: "has_money", amount: c.amount };
      case "placeholder_equals":
        return { type: "placeholder_equals", placeholder: c.placeholder, value: c.value };
      case "placeholder_match":
        return { type: "placeholder_match", placeholder: c.placeholder, regex: c.regex };
      case "expression":
        return { type: "expression", expr: c.expr };
      case "has_item":
        return { type: "has_item", material: c.material, count: c.count ?? 1 };
      case "has_xp":
        return { type: "has_xp", amount: c.amount };
      case "has_level":
        return { type: "has_level", level: c.level };
      case "world_is":
        return { type: "world_is", world: c.world };
      case "time_is":
        return { type: "time_is", range: c.range };
      case "random_chance":
        return { type: "random_chance", probability: c.probability };
      case "cooldown_passed":
        return { type: "cooldown_passed", cooldown_id: c.cooldown_id };
      case "player_in_region":
        return { type: "player_in_region", region: c.region };
      case "pagination_at_first":
      case "pagination_at_last":
        return { type: c.type, ...(c.element_id ? { elementId: c.element_id } : {}) };
      case "not": {
        const of = condition(c.of);
        return of ? { type: "not", of } : null;
      }
      case "and":
        return {
          type: "and",
          of: (c.of as Json[]).map(condition).filter(Boolean) as DomainCondition[],
        };
      case "or":
        return {
          type: "or",
          of: (c.of as Json[]).map(condition).filter(Boolean) as DomainCondition[],
        };
      default:
        pushUnsupported(`condition: ${c.type}`);
        return null;
    }
  }

  // `if` array (ANDed) → domain if[] + ifJoins all "and".
  function ifArray(
    arr: Json[] | undefined,
  ): { conds: DomainCondition[]; joins: ("and" | "or")[] } | undefined {
    if (!arr || arr.length === 0) return undefined;
    const conds = arr.map(condition).filter(Boolean) as DomainCondition[];
    if (conds.length === 0) return undefined;
    return { conds, joins: new Array(Math.max(0, conds.length - 1)).fill("and") };
  }

  // Action DSL string → domain steps
  // A DSL `@key` reference resolves to a registered LText (translation pulled
  // via `ctx.ref`); a `"literal"` mints a fresh key via `ctx.text`. The codec
  // (`parseActionDsl` + `dslStepsToSteps`) owns the action/condition vocabulary,
  // so this layer only bridges DSL text ↔ the i18n Key site.
  const toLText = (t: DslText): LText => ("ref" in t ? ref(t.ref) : text(t.lit));

  // Wire text → domain: string (literal / `{i18n:key}`) or field-local map.
  const textCodec: ActionTextCodec = { toWire: () => "", fromWire: (raw) => text(raw) };

  function dslToSteps(dsl: string): DomainStep[] {
    if (dsl.trim() === "") return [];
    try {
      return dslStepsToSteps(parseActionDsl(dsl), toLText);
    } catch (e) {
      pushUnsupported(`steps: ${(e as Error).message}`);
      return [];
    }
  }

  /**
   * Wire handler → domain steps. A string = legacy Action DSL ; `{steps:"<dsl>"}`
   * = legacy wrapped DSL ; a map/list = structured keyed (ADR
   * `structured-action-wire`). Text is bridged through the i18n Key site.
   */
  function steps(raw: unknown): DomainStep[] {
    if (typeof raw === "string") return dslToSteps(raw);
    if (raw && typeof raw === "object" && !Array.isArray(raw) && typeof (raw as Json).steps === "string") {
      return dslToSteps((raw as Json).steps);
    }
    // Pre-DSL legacy wire: a flat list of type-tagged actions (`{type:…}`).
    if (
      Array.isArray(raw) &&
      raw.length > 0 &&
      raw.every((e) => e && typeof e === "object" && "type" in (e as Json))
    ) {
      return (raw as Json[])
        .map((a) => {
          const act = action(a);
          return act ? ({ kind: "action", action: act } as DomainStep) : null;
        })
        .filter(Boolean) as DomainStep[];
    }
    try {
      return structuredToSteps(raw, textCodec);
    } catch (e) {
      pushUnsupported(`steps: ${(e as Error).message}`);
      return [];
    }
  }

  // Legacy structured actions/steps (module-data literal path only)
  function action(a: Json): DomainAction | null {
    switch (a.type) {
      case "open_menu":
        return {
          type: "open_menu",
          menuId: a.menu_id as MenuId,
          ...(a.clear_context ? { clearContext: true } : {}),
          ...(a.context ? { context: a.context } : {}),
        };
      case "close_menu":
        return { type: "close_menu" };
      case "open_previous_menu":
        return { type: "open_previous_menu" };
      case "run_command":
        return { type: "run_command", command: a.command, as: a.as ?? "player" };
      case "send_message":
        return { type: "send_message", text: text(a.text) };
      case "show_title":
        return {
          type: "show_title",
          title: text(a.title),
          ...(a.subtitle !== undefined ? { subtitle: text(a.subtitle) } : {}),
          ...(a.fade_in !== undefined ? { fadeIn: a.fade_in } : {}),
          ...(a.stay !== undefined ? { stay: a.stay } : {}),
          ...(a.fade_out !== undefined ? { fadeOut: a.fade_out } : {}),
        };
      case "give_item":
        return { type: "give_item", material: a.material, count: a.count };
      case "take_item":
        return { type: "take_item", material: a.material, count: a.count ?? 1 };
      case "take_money":
        return { type: "take_money", amount: a.amount };
      case "give_money":
        return { type: "give_money", amount: a.amount };
      case "give_xp":
        return { type: "give_xp", amount: a.amount };
      case "give_level":
        return { type: "give_level", amount: a.amount };
      case "broadcast":
        return { type: "broadcast", text: text(a.text) };
      case "play_sound":
        return {
          type: "play_sound",
          sound: a.sound,
          ...(a.volume !== undefined ? { volume: a.volume } : {}),
          ...(a.pitch !== undefined ? { pitch: a.pitch } : {}),
        };
      case "teleport": {
        if (typeof a.world !== "string" || a.world === "") {
          pushUnsupported("action: teleport (missing world)");
          return null;
        }
        return {
          type: "teleport",
          world: a.world,
          x: a.x ?? 0,
          y: a.y ?? 0,
          z: a.z ?? 0,
          ...(a.yaw !== undefined ? { yaw: a.yaw } : {}),
          ...(a.pitch !== undefined ? { pitch: a.pitch } : {}),
        };
      }
      case "pagination_next":
        return {
          type: "paginate",
          direction: "next",
          ...(a.element_id ? { targetElementId: a.element_id as ElementId } : {}),
        };
      case "pagination_prev":
        return {
          type: "paginate",
          direction: "prev",
          ...(a.element_id ? { targetElementId: a.element_id as ElementId } : {}),
        };
      case "set_arg":
        return { type: "set_arg", arg: a.arg, value: a.value };
      case "set_arg_cycle_next":
        return { type: "set_arg_cycle_next", arg: a.arg, list: a.list };
      case "set_arg_cycle_prev":
        return { type: "set_arg_cycle_prev", arg: a.arg, list: a.list };
      case "open_dialog":
        return {
          type: "open_dialog",
          dialogId: a.dialog_id as DialogId,
          ...(a.clear_context ? { clearContext: true } : {}),
          ...(a.context ? { context: a.context } : {}),
        };
      case "close_dialog":
        return { type: "close_dialog" };
      default:
        pushUnsupported(`action: ${a.type}`);
        return null;
    }
  }

  function step(s: Json): DomainStep | null {
    if (s.kind === "action") {
      const act = action(s.action);
      return act ? { kind: "action", action: act } : null;
    }
    if (s.kind === "if") {
      return {
        kind: "if",
        cases: (s.cases as Json[]).map((c) => ({
          conditions: (c.conditions as Json[]).map(condition).filter(Boolean) as DomainCondition[],
          ...(c.joins ? { joins: c.joins } : {}),
          steps: (c.steps as Json[]).map(step).filter(Boolean) as DomainStep[],
        })),
        ...(s.else ? { else: (s.else as Json[]).map(step).filter(Boolean) as DomainStep[] } : {}),
      };
    }
    pushUnsupported(`step kind: ${s.kind}`);
    return null;
  }

  return { condition, steps, action, step, ifArray };
}
