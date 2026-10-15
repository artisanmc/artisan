import type { DeclaredAction } from "@/lib/api/declaredActions";
import { type DeclaredActionLookup, declaredActionOf } from "@/lib/actions/coreActions";
import { canonicalModuleValue, normalizeModuleArgs } from "@/lib/actions/moduleActions";
import { walkActions } from "./stepPath";
import type { Action, I18nKey, LText, ModelField, Step } from "./types";

/**
 * The text slots of a Step tree, addressed as the plugin addresses them
 * (`engine/I18nAddresses.kt`, locked by `testdata/i18n-address-conformance.json`).
 *
 * A slot is one `ltext` argument of an action (or one entry of a `list(ltext)` argument),
 * found through the action's declaration: Artisan's own from `testdata/core-actions.json`,
 * a module's from the active server's `declared_actions`. The rules, driven by the schema:
 *
 *  - walk order is document order, an `if`'s cases before its `else`;
 *  - an argument with a legacy slot (`i18nSlots`) is addressed `<prefix>.<slot>`, then
 *    `<slot>_1`, `<slot>_2`…, one counter per slot (`send_message` and `broadcast` share
 *    `message`; `show_title` has `show_title` and `show_subtitle`);
 *  - any other text argument hangs off the action's name (`:` read as `.`), numbered per
 *    occurrence of that action: `<prefix>.quests.notify.text`, then
 *    `<prefix>.quests.notify_1.text`; a list numbers its entries `…lines`, `…lines_2`…;
 *  - an absent optional text consumes no counter; an undeclared action has no slot.
 *
 * The slot carries the live value (an {@link LText} node once adopted, the wire text —
 * string or `{lang: text}` map — before) and a setter, so the i18n lifecycle can fold over
 * it: `visitStepLTexts` yields the adopted nodes as key sites, `adoptActionTexts` turns the
 * wire texts into nodes at their address.
 */
export interface ActionTextSlot {
  /** The live value: an LText node, or the wire text when not adopted yet. */
  get: () => unknown;
  /** Replace the value by an LText node (immer draft or plain object). */
  set: (node: LText) => void;
  /** Canonical position-derived key (the plugin's address). */
  key: I18nKey;
  /** Human display path (Translations panel). */
  path: string;
  /** Legacy slot name when the argument has one (`message`, `show_title`, `show_subtitle`). */
  slot: string | null;
}

export const isLTextNode = (v: unknown): v is LText =>
  typeof v === "object" &&
  v !== null &&
  !Array.isArray(v) &&
  typeof (v as { key?: unknown }).key === "string" &&
  Object.keys(v as object).length === 1;

const suffixed = (prefix: string, leaf: string, index: number): string =>
  index === 0 ? `${prefix}.${leaf}` : `${prefix}.${leaf}_${index}`;

/** The wire name and the argument accessors of an action, whatever its editor shape. */
interface ActionArgs {
  name: string;
  get: (arg: string) => unknown;
  set: (arg: string, value: unknown) => void;
}

function actionArgs(action: Action, decl: DeclaredAction): ActionArgs {
  if (action.type === "module") {
    return {
      name: action.name,
      get: (arg) => normalizeModuleArgs(decl, action.value)[arg],
      set: (arg, value) => {
        action.value = canonicalModuleValue(decl, {
          ...normalizeModuleArgs(decl, action.value),
          [arg]: value,
        });
      },
    };
  }
  // A core action of the typed union: its text arguments carry the wire name
  // (`text`, `title`, `subtitle`), so the declaration reads them directly.
  const record = action as unknown as Record<string, unknown>;
  return {
    name: action.type,
    get: (arg) => record[arg],
    set: (arg, value) => {
      record[arg] = value;
    },
  };
}

/** The wire name of an editor action: `paginate` is `pagination_next`/`pagination_prev`. */
export function actionWireName(action: Action): string {
  if (action.type === "module") return action.name;
  if (action.type === "paginate")
    return action.direction === "next" ? "pagination_next" : "pagination_prev";
  return action.type;
}

function isTextArg(arg: ModelField): boolean {
  return arg.type.kind === "ltext";
}

function isTextListArg(arg: ModelField): boolean {
  return arg.type.kind === "list" && arg.type.of.kind === "ltext";
}

export function* walkStepTextSlots(
  steps: Step[],
  prefix: string,
  declOf: DeclaredActionLookup = declaredActionOf,
): Generator<ActionTextSlot> {
  const counters = new Map<string, number>();
  const next = (slot: string): number => {
    const n = counters.get(slot) ?? 0;
    counters.set(slot, n + 1);
    return n;
  };
  for (const action of walkActions(steps)) {
    const wireName = actionWireName(action);
    const decl = declOf(wireName);
    if (!decl) continue;
    const args = actionArgs(action, decl);
    // The generic base is minted once per step, on its first slot-less text.
    let base: string | null = null;
    const baseOf = (): string => {
      if (base === null)
        base = suffixed(prefix, wireName.replace(/:/g, "."), next(`action:${wireName}`));
      return base;
    };
    for (const arg of decl.args) {
      const slot = decl.i18nSlots?.[arg.name] ?? null;
      const value = args.get(arg.name);
      if (isTextArg(arg)) {
        if (value == null && !arg.required) continue;
        const key = slot !== null ? suffixed(prefix, slot, next(slot)) : `${baseOf()}.${arg.name}`;
        yield {
          get: () => args.get(arg.name),
          set: (node) => args.set(arg.name, node),
          key: key as I18nKey,
          // Display path: `…message` collapses the message index; every other text reads
          // `…<action>.<argument>` (`…show_title.title`, `…quests.notify.text`).
          path: slot === "message" ? `${prefix}.message` : `${prefix}.${wireName}.${arg.name}`,
          slot,
        };
      } else if (isTextListArg(arg)) {
        if (!Array.isArray(value)) continue;
        const listBase =
          slot !== null ? suffixed(prefix, slot, next(slot)) : `${baseOf()}.${arg.name}`;
        for (let i = 0; i < value.length; i++) {
          const key = i === 0 ? listBase : `${listBase}_${i + 1}`;
          yield {
            get: () => (args.get(arg.name) as unknown[] | undefined)?.[i],
            set: (node) => {
              const list = [...((args.get(arg.name) as unknown[] | undefined) ?? [])];
              list[i] = node;
              args.set(arg.name, list);
            },
            key: key as I18nKey,
            path: `${prefix}.${wireName}.${arg.name}[${i}]`,
            slot,
          };
        }
      }
    }
  }
}
