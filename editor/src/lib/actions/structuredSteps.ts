import type { Action, Condition, ElementId, I18nKey, IfCase, LText, MenuId, DialogId, Step } from "@/domain/types";

/**
 * Codec structuré des chaînes d'actions (ADR `structured-action-wire`).
 *
 * Wire = YAML keyed par nom, texte = `LocalizedText` (string = `defaultLang`, ou
 * `{ <lang>: texte }`). Éditeur : domaine `Step[]` ⇄ wire structuré.
 *
 * Formes :
 *  - action = map à une clé : 1 arg → valeur, 0 arg → `null`, multi → map.
 *  - condition = map à une clé ; `if:` = liste (AND) ; `or:`/`and:` = liste,
 *    `not:` = condition ; `else if` = `if` en tête du `else`.
 *  - un step string (en entrée de liste) = action sans argument.
 *
 * `LocalizedText` est indentique côté structurel : `string | Record<lang,string>`.
 */
export type FieldText = string | Record<string, string>;
/** Wire step, untrusted (YAML/JSON). */
export type StructuredStep = string | Record<string, unknown>;

/** Texte d'action : domaine `LText` ⇄ wire `FieldText`. */
export interface ActionTextCodec {
  toWire: (key: I18nKey) => FieldText;
  fromWire: (raw: FieldText) => LText;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** A single-key action/condition map, or the bare string for an arg-less action. */
function oneName(raw: Record<string, unknown>): { name: string; value: unknown } | null {
  const keys = Object.keys(raw);
  if (keys.length !== 1) return null;
  const name = keys[0]!;
  return { name, value: raw[name] };
}

// ── text ─────────────────────────────────────────────────────────────────────

/** Wire text value is a string or a lang map. */
function isFieldText(v: unknown): v is FieldText {
  return typeof v === "string" || (isRecord(v) && Object.values(v).every((x) => typeof x === "string"));
}

function decodeText(v: unknown, c: ActionTextCodec): LText {
  if (isFieldText(v)) return c.fromWire(v);
  return c.fromWire(typeof v === "string" ? v : "");
}

// ── actions: encode ──────────────────────────────────────────────────────────

function encodeAction(a: Action, c: ActionTextCodec): StructuredStep {
  switch (a.type) {
    case "send_message":
      return { send_message: c.toWire(a.text.key) };
    case "broadcast":
      return { broadcast: c.toWire(a.text.key) };
    case "give_xp":
      return { give_xp: a.amount };
    case "give_level":
      return { give_level: a.amount };
    case "give_money":
      return { give_money: a.amount };
    case "take_money":
      return { take_money: a.amount };
    // Arg-less actions canonically serialize as their bare name (a string step);
    // `close_menu:` (null) is still accepted on read.
    case "close_menu":
      return "close_menu";
    case "close_dialog":
      return "close_dialog";
    case "open_previous_menu":
      return "open_previous_menu";
    case "run_command":
      return a.as === "player" ? { run_command: a.command } : { run_command: { command: a.command, as: a.as } };
    case "give_item":
      return { give_item: { material: a.material, count: a.count } };
    case "take_item":
      return { take_item: { material: a.material, count: a.count } };
    case "play_sound":
      return a.volume === undefined && a.pitch === undefined
        ? { play_sound: a.sound }
        : { play_sound: { sound: a.sound, ...(a.volume !== undefined ? { volume: a.volume } : {}), ...(a.pitch !== undefined ? { pitch: a.pitch } : {}) } };
    case "teleport":
      return {
        teleport: {
          world: a.world,
          x: a.x,
          y: a.y,
          z: a.z,
          ...(a.yaw !== undefined ? { yaw: a.yaw } : {}),
          ...(a.pitch !== undefined ? { pitch: a.pitch } : {}),
        },
      };
    case "open_menu": {
      const hasExtras = a.context !== undefined || a.clearContext !== undefined;
      return hasExtras
        ? {
            open_menu: {
              menu_id: a.menuId,
              ...(a.context ? { context: a.context } : {}),
              ...(a.clearContext !== undefined ? { clear_context: a.clearContext } : {}),
            },
          }
        : { open_menu: a.menuId };
    }
    case "open_dialog": {
      const hasExtras = a.context !== undefined || a.clearContext !== undefined;
      return hasExtras
        ? {
            open_dialog: {
              dialog_id: a.dialogId,
              ...(a.context ? { context: a.context } : {}),
              ...(a.clearContext !== undefined ? { clear_context: a.clearContext } : {}),
            },
          }
        : { open_dialog: a.dialogId };
    }
    case "paginate":
      return a.direction === "next"
        ? { pagination_next: a.targetElementId ?? null }
        : { pagination_prev: a.targetElementId ?? null };
    case "show_title":
      return {
        show_title: {
          title: c.toWire(a.title.key),
          ...(a.subtitle ? { subtitle: c.toWire(a.subtitle.key) } : {}),
          ...(a.fadeIn !== undefined ? { fade_in: a.fadeIn } : {}),
          ...(a.stay !== undefined ? { stay: a.stay } : {}),
          ...(a.fadeOut !== undefined ? { fade_out: a.fadeOut } : {}),
        },
      };
    case "set_arg":
      return { set_arg: { arg: a.arg, value: a.value } };
    case "set_arg_cycle_next":
      return { set_arg_cycle_next: { arg: a.arg, list: a.list } };
    case "set_arg_cycle_prev":
      return { set_arg_cycle_prev: { arg: a.arg, list: a.list } };
    case "run_actions":
      return { run_actions: a.actions };
  }
}

// ── actions: decode ──────────────────────────────────────────────────────────

function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}
function num(v: unknown): number {
  return typeof v === "number" ? v : Number(v);
}
function argsMap(v: unknown): Record<string, unknown> {
  return isRecord(v) ? v : {};
}

function decodeAction(name: string, value: unknown, c: ActionTextCodec): Action {
  const o = argsMap(value);
  switch (name) {
    case "send_message":
      return { type: "send_message", text: decodeText(value, c) };
    case "broadcast":
      return { type: "broadcast", text: decodeText(value, c) };
    case "give_xp":
      return { type: "give_xp", amount: num(value) };
    case "give_level":
      return { type: "give_level", amount: num(value) };
    case "give_money":
      return { type: "give_money", amount: num(value) };
    case "take_money":
      return { type: "take_money", amount: num(value) };
    case "close_menu":
      return { type: "close_menu" };
    case "close_dialog":
      return { type: "close_dialog" };
    case "open_previous_menu":
      return { type: "open_previous_menu" };
    case "run_command":
      return typeof value === "string"
        ? { type: "run_command", command: value, as: "player" }
        : { type: "run_command", command: str(o.command), as: o.as === "console" ? "console" : "player" };
    case "give_item":
      return { type: "give_item", material: str(o.material), count: num(o.count) };
    case "take_item":
      return { type: "take_item", material: str(o.material), count: num(o.count) };
    case "play_sound":
      return typeof value === "string"
        ? { type: "play_sound", sound: value }
        : { type: "play_sound", sound: str(o.sound), ...(o.volume !== undefined ? { volume: num(o.volume) } : {}), ...(o.pitch !== undefined ? { pitch: num(o.pitch) } : {}) };
    case "teleport":
      return {
        type: "teleport",
        world: str(o.world),
        x: num(o.x),
        y: num(o.y),
        z: num(o.z),
        ...(o.yaw !== undefined ? { yaw: num(o.yaw) } : {}),
        ...(o.pitch !== undefined ? { pitch: num(o.pitch) } : {}),
      };
    case "open_menu":
      return typeof value === "string"
        ? { type: "open_menu", menuId: value as MenuId }
        : {
            type: "open_menu",
            menuId: str(o.menu_id) as MenuId,
            ...(isRecord(o.context) ? { context: o.context as Record<string, string> } : {}),
            ...(o.clear_context !== undefined ? { clearContext: o.clear_context === true } : {}),
          };
    case "open_dialog":
      return typeof value === "string"
        ? { type: "open_dialog", dialogId: value as DialogId }
        : {
            type: "open_dialog",
            dialogId: str(o.dialog_id) as DialogId,
            ...(isRecord(o.context) ? { context: o.context as Record<string, string> } : {}),
            ...(o.clear_context !== undefined ? { clearContext: o.clear_context === true } : {}),
          };
    case "pagination_next":
      return { type: "paginate", direction: "next", ...(typeof value === "string" ? { targetElementId: value as ElementId } : {}) };
    case "pagination_prev":
      return { type: "paginate", direction: "prev", ...(typeof value === "string" ? { targetElementId: value as ElementId } : {}) };
    case "show_title":
      return {
        type: "show_title",
        title: decodeText(o.title, c),
        ...(o.subtitle !== undefined ? { subtitle: decodeText(o.subtitle, c) } : {}),
        ...(o.fade_in !== undefined ? { fadeIn: num(o.fade_in) } : {}),
        ...(o.stay !== undefined ? { stay: num(o.stay) } : {}),
        ...(o.fade_out !== undefined ? { fadeOut: num(o.fade_out) } : {}),
      };
    case "set_arg":
      return { type: "set_arg", arg: str(o.arg), value: str(o.value) };
    case "set_arg_cycle_next":
      return { type: "set_arg_cycle_next", arg: str(o.arg), list: str(o.list) };
    case "set_arg_cycle_prev":
      return { type: "set_arg_cycle_prev", arg: str(o.arg), list: str(o.list) };
    case "run_actions":
      return { type: "run_actions", actions: str(value) };
    default:
      // Unknown verb → a no-op run_actions on the raw name (tolerant, never throws).
      return { type: "run_actions", actions: "" };
  }
}

// ── conditions: encode ───────────────────────────────────────────────────────

export function conditionToStructured(c: Condition): Record<string, unknown> {
  switch (c.type) {
    case "has_permission":
      return { has_permission: c.perm };
    case "has_money":
      return { has_money: c.amount };
    case "has_item":
      return { has_item: { material: c.material, count: c.count } };
    case "has_xp":
      return { has_xp: c.amount };
    case "has_level":
      return { has_level: c.level };
    case "world_is":
      return { world_is: c.world };
    case "random_chance":
      return { random_chance: c.probability };
    case "cooldown_passed":
      return { cooldown_passed: c.cooldown_id };
    case "player_in_region":
      return { player_in_region: c.region };
    case "time_is":
      return { time_is: c.range };
    case "placeholder_equals":
      return { placeholder_equals: { placeholder: c.placeholder, value: c.value } };
    case "placeholder_match":
      return { placeholder_match: { placeholder: c.placeholder, regex: c.regex } };
    case "pagination_at_first":
      return { pagination_at_first: c.elementId ?? null };
    case "pagination_at_last":
      return { pagination_at_last: c.elementId ?? null };
    case "expression":
      return { expression: c.expr };
    case "not":
      return { not: conditionToStructured(c.of) };
    case "and":
      return { and: c.of.map(conditionToStructured) };
    case "or":
      return { or: c.of.map(conditionToStructured) };
  }
}

/** Conditions of an `if:`, AND-implicit. A pure-OR flat list is wrapped in `or:`.
 *  Exported for appearance/state `if` (ADR `structured-action-wire`). */
export function conditionsToStructured(
  conditions: Condition[],
  joins?: ("and" | "or")[],
): unknown[] {
  if (conditions.length > 1 && (joins?.[0] ?? "and") === "or") {
    return [{ or: conditions.map(conditionToStructured) }];
  }
  return conditions.map(conditionToStructured);
}

// ── conditions: decode ───────────────────────────────────────────────────────

/** Keyed condition (wire) → domain, or null if unknown. Exported for
 *  appearance/state `if` import (ADR `structured-action-wire`). */
export function conditionFromStructured(raw: unknown): Condition | null {
  return decodeCondition(raw);
}

function decodeCondition(raw: unknown): Condition | null {
  const m = oneName(argsMap(raw));
  const name = m?.name ?? "";
  const value = m?.value;
  const o = argsMap(value);
  switch (name) {
    case "has_permission":
      return { type: "has_permission", perm: str(value) };
    case "has_money":
      return { type: "has_money", amount: num(value) };
    case "has_item":
      return { type: "has_item", material: str(o.material), count: num(o.count) };
    case "has_xp":
      return { type: "has_xp", amount: num(value) };
    case "has_level":
      return { type: "has_level", level: num(value) };
    case "world_is":
      return { type: "world_is", world: str(value) };
    case "random_chance":
      return { type: "random_chance", probability: num(value) };
    case "cooldown_passed":
      return { type: "cooldown_passed", cooldown_id: str(value) };
    case "player_in_region":
      return { type: "player_in_region", region: str(value) };
    case "time_is":
      return {
        type: "time_is",
        range:
          typeof value === "string"
            ? (value as "day" | "night")
            : { from_ticks: num(o.from_ticks), to_ticks: num(o.to_ticks) },
      };
    case "placeholder_equals":
      return { type: "placeholder_equals", placeholder: str(o.placeholder), value: str(o.value) };
    case "placeholder_match":
      return { type: "placeholder_match", placeholder: str(o.placeholder), regex: str(o.regex) };
    case "pagination_at_first":
      return { type: "pagination_at_first", ...(typeof value === "string" ? { elementId: value } : {}) };
    case "pagination_at_last":
      return { type: "pagination_at_last", ...(typeof value === "string" ? { elementId: value } : {}) };
    case "expression":
      return { type: "expression", expr: str(value) };
    case "not": {
      const of = decodeCondition(value);
      return of ? { type: "not", of } : null;
    }
    case "and":
      return {
        type: "and",
        of: (Array.isArray(value) ? value : [])
          .map(decodeCondition)
          .filter((c): c is Condition => c !== null),
      };
    case "or":
      return {
        type: "or",
        of: (Array.isArray(value) ? value : [])
          .map(decodeCondition)
          .filter((c): c is Condition => c !== null),
      };
    default:
      return null;
  }
}

function decodeIfConditions(raw: unknown): Condition[] {
  const list = Array.isArray(raw) ? raw : [raw];
  return list.map(decodeCondition).filter((c): c is Condition => c !== null);
}

// ── steps ────────────────────────────────────────────────────────────────────

export function stepsToStructured(steps: Step[], c: ActionTextCodec): StructuredStep[] {
  return steps.map((s) => encodeStep(s, c));
}

function encodeStep(s: Step, c: ActionTextCodec): StructuredStep {
  if (s.kind === "action") return encodeAction(s.action, c);
  return encodeIf(s.cases, s.else, c);
}

function encodeIf(cases: IfCase[], elseSteps: Step[] | undefined, c: ActionTextCodec): Record<string, unknown> {
  const [first, ...rest] = cases;
  if (!first) return { if: [], do: [] };
  const node: Record<string, unknown> = {
    if: conditionsToStructured(first.conditions, first.joins),
    do: first.steps.map((s) => encodeStep(s, c)),
  };
  const nestedElse = rest.length > 0 ? [encodeIf(rest, elseSteps, c)] : elseSteps?.map((s) => encodeStep(s, c));
  if (nestedElse && nestedElse.length > 0) node.else = nestedElse;
  return node;
}

export function structuredToSteps(raw: unknown, c: ActionTextCodec): Step[] {
  if (raw === undefined || raw === null) return [];
  if (typeof raw === "string") {
    // Legacy DSL string or a single arg-less action name.
    return [decodeStep(raw, c)];
  }
  if (Array.isArray(raw)) return raw.map((s) => decodeStep(s, c));
  return [decodeStep(raw, c)];
}

function decodeStep(raw: unknown, c: ActionTextCodec): Step {
  if (typeof raw === "string") {
    return { kind: "action", action: decodeAction(raw, null, c) };
  }
  const rawObj = argsMap(raw);
  if ("if" in rawObj) return decodeIf(rawObj, c);
  const m = oneName(rawObj);
  return { kind: "action", action: decodeAction(m?.name ?? "", m?.value, c) };
}

function decodeIf(node: Record<string, unknown>, c: ActionTextCodec): Step {
  const cases: IfCase[] = [];
  let current = node;
  let elseSteps: Step[] | undefined;
  // The wire is recursive `else`; fold a leading `if` back into the cases list.
  while (true) {
    cases.push({
      conditions: decodeIfConditions(current.if),
      steps: (Array.isArray(current.do) ? current.do : []).map((s) => decodeStep(s, c)),
    });
    const els = current.else;
    const firstElse = Array.isArray(els) ? els[0] : undefined;
    if (Array.isArray(els) && els.length === 1 && isRecord(firstElse) && "if" in firstElse) {
      current = firstElse;
      continue;
    }
    elseSteps = Array.isArray(els) ? els.map((s) => decodeStep(s, c)) : undefined;
    break;
  }
  return { kind: "if", cases, ...(elseSteps && elseSteps.length > 0 ? { else: elseSteps } : {}) };
}
