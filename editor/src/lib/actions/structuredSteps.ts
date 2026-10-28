import { canonicalActionValue, isLTextNode, normalizeActionArgs } from "@/domain/actionArgs";
import type { Action, Condition, I18nKey, IfCase, LText, Step } from "@/domain/types";
import {
  type DeclaredActionLookup,
  declarationOfAction,
  declaredActionOf,
  isCoreAction,
} from "@/lib/actions/coreActions";

/**
 * Structured codec for action chains (ADR `structured-action-wire`).
 *
 * Wire = YAML keyed by name, text = `LocalizedText` (string = `defaultLang`, or
 * `{ <lang>: text }`). Editor: domain `Step[]` ⇄ structured wire.
 *
 * Shapes:
 *  - action = single-key map: 1 arg → value, 0 args → `null`, several → map.
 *  - condition = single-key map; `if:` = list (AND); `or:`/`and:` = list,
 *    `not:` = condition; `else if` = `if` at the head of the `else`.
 *  - a string step (as a list entry) = action without arguments.
 *
 * `LocalizedText` is structurally identical: `string | Record<lang,string>`.
 */
export type FieldText = string | Record<string, string>;
/** Wire step, untrusted (YAML/JSON). */
export type StructuredStep = string | Record<string, unknown>;

/** Action text: `LText` domain ⇄ `FieldText` wire. */
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

// Text

/** Wire text value is a string or a lang map. */
function isFieldText(v: unknown): v is FieldText {
  return (
    typeof v === "string" || (isRecord(v) && Object.values(v).every((x) => typeof x === "string"))
  );
}

// Actions

function argsMap(v: unknown): Record<string, unknown> {
  return isRecord(v) ? v : {};
}
function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}
function num(v: unknown): number {
  return typeof v === "number" ? v : Number(v);
}

/** Wire text (string or language map) → LText through the codec. */
function decodeText(v: unknown, c: ActionTextCodec): LText {
  if (isFieldText(v)) return c.fromWire(v);
  return c.fromWire(typeof v === "string" ? v : "");
}

/** Every LText node inside a value (top-level arguments, list entries, nested records) → wire text. */
function encodeTexts(value: unknown, c: ActionTextCodec): unknown {
  if (isLTextNode(value)) return c.toWire(value.key);
  if (Array.isArray(value)) return value.map((v) => encodeTexts(v, c));
  if (isRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = encodeTexts(v, c);
    return out;
  }
  return value;
}

/**
 * An action → its keyed step: the bare name when it has no argument, `{name: value}`
 * otherwise, the value in its canonical form (`canonicalActionValue`: defaults dropped,
 * the primary alone when it is the only argument) with adopted texts written back as
 * field-local text. An undeclared action is written as it was read.
 */
function encodeAction(a: Action, c: ActionTextCodec, declOf: DeclaredActionLookup): StructuredStep {
  const decl = declarationOfAction(a, declOf);
  const value = decl
    ? canonicalActionValue(
        decl,
        encodeTexts(normalizeActionArgs(decl, a.value), c) as Record<string, unknown>,
      )
    : encodeTexts(a.value, c);
  // No value: the bare name, unless the declaration has arguments (then `{name: null}`
  // says "none of them", like `pagination_next: null`).
  if (value == null) return decl && decl.args.length > 0 ? { [a.name]: null } : a.name;
  return { [a.name]: value };
}

/**
 * A keyed step → an action. A core action's text arguments (`ltext`, `list(ltext)`) go
 * through the codec into LText nodes here, like a title; a module's action is kept
 * verbatim — its texts become nodes once its declaration is known (`adoptActionTexts`),
 * since the server may not have reported it yet. The value is stored canonical.
 */
function decodeAction(
  name: string,
  value: unknown,
  c: ActionTextCodec,
  declOf: DeclaredActionLookup,
): Action {
  const decl = declOf(name);
  if (!decl || !isCoreAction(name)) return { name, value: value ?? null };
  const args = normalizeActionArgs(decl, value);
  for (const arg of decl.args) {
    const v = args[arg.name];
    if (v === undefined) continue;
    if (arg.type.kind === "ltext") args[arg.name] = decodeText(v, c);
    else if (arg.type.kind === "list" && arg.type.of.kind === "ltext" && Array.isArray(v))
      args[arg.name] = v.map((e) => decodeText(e, c));
  }
  return { name, value: canonicalActionValue(decl, args) };
}

// Conditions: encode

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

/** Conditions of an `if:`, AND-implicit. Flat `joins` are folded left to right,
 *  without precedence — the plugin's historical `caseMatches` semantics:
 *  `A and B or C` → `(A and B) or C`, `A or B and C` → `(A or B) and C`.
 *  Exported for appearance/state `if` (ADR `structured-action-wire`). */
export function conditionsToStructured(
  conditions: Condition[],
  joins?: ("and" | "or")[],
): unknown[] {
  if (conditions.length === 0) return [];
  let acc: Condition = conditions[0]!;
  for (let i = 1; i < conditions.length; i++) {
    const op = joins?.[i - 1] ?? "and";
    const next = conditions[i]!;
    acc =
      acc.type === op && i > 1
        ? { type: op, of: [...acc.of, next] }
        : { type: op, of: [acc, next] };
  }
  // Top-level AND is the list itself.
  const top = conditions.length > 1 && acc.type === "and" ? acc.of : [acc];
  return top.map(conditionToStructured);
}

// Conditions: decode

/** Keyed condition (wire) → domain, or null if unknown. Exported for
 *  appearance/state `if` import (ADR `structured-action-wire`). */
export function conditionFromStructured(raw: unknown): Condition | null {
  return decodeCondition(raw);
}

const CONDITION_NAMES = new Set<string>([
  "has_permission",
  "has_money",
  "has_item",
  "has_xp",
  "has_level",
  "world_is",
  "random_chance",
  "cooldown_passed",
  "player_in_region",
  "time_is",
  "placeholder_equals",
  "placeholder_match",
  "pagination_at_first",
  "pagination_at_last",
  "expression",
]);

/**
 * True when the editor decodes a keyed condition whole: its name and every nested one are
 * Artisan's (`not:` / `and:` / `or:` included). A module's condition, a type-tagged entry or a
 * malformed group is false, and must be kept as read rather than decoded (which drops it).
 */
export function isDecodableCondition(raw: unknown): boolean {
  const m = oneName(argsMap(raw));
  if (!m) return false;
  if (m.name === "not") return isDecodableCondition(m.value);
  if (m.name === "and" || m.name === "or")
    return Array.isArray(m.value) && m.value.every(isDecodableCondition);
  return CONDITION_NAMES.has(m.name);
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
      return {
        type: "pagination_at_first",
        ...(typeof value === "string" ? { elementId: value } : {}),
      };
    case "pagination_at_last":
      return {
        type: "pagination_at_last",
        ...(typeof value === "string" ? { elementId: value } : {}),
      };
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

// Steps

/**
 * Domain steps → keyed wire. `declOf` finds each action's declaration (Artisan's table,
 * then the active server's `declared_actions` by default) for its canonical form.
 */
export function stepsToStructured(
  steps: Step[],
  c: ActionTextCodec,
  declOf: DeclaredActionLookup = declaredActionOf,
): StructuredStep[] {
  return steps.map((s) => encodeStep(s, c, declOf));
}

function encodeStep(s: Step, c: ActionTextCodec, d: DeclaredActionLookup): StructuredStep {
  if (s.kind === "action") return encodeAction(s.action, c, d);
  return encodeIf(s.cases, s.else, c, d);
}

function encodeIf(
  cases: IfCase[],
  elseSteps: Step[] | undefined,
  c: ActionTextCodec,
  d: DeclaredActionLookup,
): Record<string, unknown> {
  const [first, ...rest] = cases;
  if (!first) return { if: [], do: [] };
  const node: Record<string, unknown> = {
    if: conditionsToStructured(first.conditions, first.joins),
    do: first.steps.map((s) => encodeStep(s, c, d)),
  };
  const nestedElse =
    rest.length > 0
      ? [encodeIf(rest, elseSteps, c, d)]
      : elseSteps?.map((s) => encodeStep(s, c, d));
  if (nestedElse && nestedElse.length > 0) node.else = nestedElse;
  return node;
}

/** Keyed wire → domain steps (map = one step, list = a chain, string = an arg-less action). */
export function structuredToSteps(
  raw: unknown,
  c: ActionTextCodec,
  declOf: DeclaredActionLookup = declaredActionOf,
): Step[] {
  if (raw === undefined || raw === null) return [];
  if (typeof raw === "string") {
    // Legacy DSL string or a single arg-less action name.
    return [decodeStep(raw, c, declOf)];
  }
  if (Array.isArray(raw)) return raw.map((s) => decodeStep(s, c, declOf));
  return [decodeStep(raw, c, declOf)];
}

function decodeStep(raw: unknown, c: ActionTextCodec, d: DeclaredActionLookup): Step {
  if (typeof raw === "string") {
    return { kind: "action", action: decodeAction(raw, null, c, d) };
  }
  const rawObj = argsMap(raw);
  if ("if" in rawObj) return decodeIf(rawObj, c, d);
  const m = oneName(rawObj);
  return { kind: "action", action: decodeAction(m?.name ?? "", m?.value, c, d) };
}

function decodeIf(
  node: Record<string, unknown>,
  c: ActionTextCodec,
  d: DeclaredActionLookup,
): Step {
  const cases: IfCase[] = [];
  let current = node;
  let elseSteps: Step[] | undefined;
  // The wire is recursive `else`; fold a leading `if` back into the cases list.
  while (true) {
    cases.push({
      conditions: decodeIfConditions(current.if),
      steps: (Array.isArray(current.do) ? current.do : []).map((s) => decodeStep(s, c, d)),
    });
    const els = current.else;
    const firstElse = Array.isArray(els) ? els[0] : undefined;
    if (Array.isArray(els) && els.length === 1 && isRecord(firstElse) && "if" in firstElse) {
      current = firstElse;
      continue;
    }
    elseSteps = Array.isArray(els) ? els.map((s) => decodeStep(s, c, d)) : undefined;
    break;
  }
  return { kind: "if", cases, ...(elseSteps && elseSteps.length > 0 ? { else: elseSteps } : {}) };
}
