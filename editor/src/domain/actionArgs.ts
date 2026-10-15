import { type DeclaredActionLookup, declaredActionOf } from "@/lib/actions/coreActions";
import type { DeclaredAction } from "@/lib/api/declaredActions";
import { walkActions } from "./stepPath";
import type { Action, LText, ModelField, Step } from "./types";

/**
 * Reading and writing an {@link Action}'s arguments through its declaration (ADR
 * `extensible-document-kinds`, R1/W4). The wire value ⇄ argument map rule is the server's
 * (`ActionDeclaration.normalize` / `canonical`, ADR `structured-action-wire`): null is no
 * argument, a map whose keys are all declared arguments is the argument map, anything else
 * — an {@link LText} node included — is the primary argument's value; the editor writes the
 * shortest form back. Every reader of an action's arguments goes through here, core or
 * module alike: the form, the pseudocode, the text slots, the `document_ref` edges.
 */

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** An adopted text: an object whose only key is the `LText` key. */
export const isLTextNode = (v: unknown): v is LText =>
  isRecord(v) && typeof v.key === "string" && Object.keys(v).length === 1;

export function normalizeActionArgs(decl: DeclaredAction, value: unknown): Record<string, unknown> {
  if (value == null) return {};
  if (isRecord(value) && !isLTextNode(value) && isArgsMap(decl, value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) if (v != null) out[k] = v;
    return out;
  }
  return decl.primary ? { [decl.primary]: value } : {};
}

function isArgsMap(decl: DeclaredAction, map: Record<string, unknown>): boolean {
  if (decl.args.length === 0) return true;
  const keys = Object.keys(map);
  if (keys.length === 0) return decl.primary === null;
  return keys.every((k) => decl.args.some((a) => a.name === k));
}

/**
 * The shortest wire value of an argument map, the server's `canonical` rule applied the way
 * the editor writes it: a required argument is always written (filled from its declared
 * default when unset, as the menu/v1 schema requires it on the wire), an optional one left
 * unset or equal to its default is dropped (the server binds the default back); then null
 * for no argument, the primary's value alone, or the map.
 */
export function canonicalActionValue(decl: DeclaredAction, args: Record<string, unknown>): unknown {
  const set: Record<string, unknown> = {};
  for (const field of decl.args) {
    let v = args[field.name];
    if (v == null && field.required) v = field.default;
    if (v == null) continue;
    if (
      !field.required &&
      field.default !== undefined &&
      JSON.stringify(field.default) === JSON.stringify(v)
    )
      continue;
    set[field.name] = v;
  }
  for (const [k, v] of Object.entries(args)) {
    if (v != null && !(k in set) && !decl.args.some((a) => a.name === k)) set[k] = v;
  }
  const keys = Object.keys(set);
  if (keys.length === 0) return null;
  if (decl.primary && keys.length === 1 && keys[0] === decl.primary) return set[decl.primary];
  return set;
}

/** The argument map of an action, `{}` when it is not declared. */
export function actionArgsOf(
  action: Action,
  declOf: DeclaredActionLookup = declaredActionOf,
): Record<string, unknown> {
  const decl = declOf(action.name);
  return decl ? normalizeActionArgs(decl, action.value) : {};
}

/** One argument of an action, `undefined` when absent or undeclared. */
export function actionArg(
  action: Action,
  arg: string,
  declOf: DeclaredActionLookup = declaredActionOf,
): unknown {
  return actionArgsOf(action, declOf)[arg];
}

/** A copy of the action with one argument replaced (`undefined` removes it), in canonical form. */
export function withActionArg(
  action: Action,
  decl: DeclaredAction,
  arg: string,
  value: unknown,
): Action {
  return {
    name: action.name,
    value: canonicalActionValue(decl, { ...normalizeActionArgs(decl, action.value), [arg]: value }),
  };
}

/** Set one argument in place (an immer draft or a fresh clone), in canonical form. */
export function setActionArg(
  action: Action,
  decl: DeclaredAction,
  arg: string,
  value: unknown,
): void {
  action.value = canonicalActionValue(decl, {
    ...normalizeActionArgs(decl, action.value),
    [arg]: value,
  });
}

/** The argument accessors of an action through its declaration. */
export interface ActionArgs {
  get: (arg: string) => unknown;
  set: (arg: string, value: unknown) => void;
}

export function actionArgs(action: Action, decl: DeclaredAction): ActionArgs {
  return {
    get: (arg) => normalizeActionArgs(decl, action.value)[arg],
    set: (arg, value) => setActionArg(action, decl, arg, value),
  };
}

/**
 * A `document_ref` argument of an action (ADR `extensible-document-kinds`, R3): the kind of
 * Document it names (`menu`, `dialog`, a module's kind), its current id and a setter. The
 * edges of the board, the clipboard's id rewrite and a Document's rename all read refs here
 * rather than knowing `open_menu`.
 */
export interface DocumentRefSlot {
  action: Action;
  arg: ModelField;
  /** The Document kind the argument references. */
  document: string;
  /** The referenced id (`""` when the argument is unset). */
  id: string;
  set: (id: string) => void;
}

export function* actionDocumentRefs(
  action: Action,
  declOf: DeclaredActionLookup = declaredActionOf,
): Generator<DocumentRefSlot> {
  const decl = declOf(action.name);
  if (!decl) return;
  const args = actionArgs(action, decl);
  for (const arg of decl.args) {
    if (arg.type.kind !== "document_ref") continue;
    const value = args.get(arg.name);
    yield {
      action,
      arg,
      document: arg.type.document,
      id: typeof value === "string" ? value : "",
      set: (id) => args.set(arg.name, id === "" ? undefined : id),
    };
  }
}

/** Every `document_ref` argument of a Step tree, in document order. */
export function* walkDocumentRefs(
  steps: Step[],
  declOf: DeclaredActionLookup = declaredActionOf,
): Generator<DocumentRefSlot> {
  for (const action of walkActions(steps)) yield* actionDocumentRefs(action, declOf);
}
