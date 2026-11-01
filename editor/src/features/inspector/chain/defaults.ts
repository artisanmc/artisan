import { canonicalActionValue } from "@/domain/actionArgs";
import { defaultValueForModelType } from "@/domain/dataModels";
import type { Action, I18nKey, MenuId } from "@/domain/types";
import { CORE_ACTIONS, coreActionOf } from "@/lib/actions/coreActions";
import type { DeclaredAction } from "@/lib/api/declaredActions";

/**
 * Sensible-empty Action seed for "+ Add action" pickers, from the action's declaration
 * (ADR `extensible-document-kinds`, R1/W4): every argument that carries a default or is
 * required starts set, so the chain the editor writes is what the server binds. A core
 * action may add an editor seed ({@link CORE_SEEDS}: a material, a sound, a position) so
 * the user starts from something valid rather than empty. No argument → the bare name.
 *
 * A required text starts as the unallocated LText sentinel; the store mutator that
 * performs the insertion detects it and allocates a fresh i18n key at the slot's address,
 * so the caller needs no draft access here. In literal-text mode (module-data steps) the
 * string itself is the value.
 */
export const UNALLOCATED_LTEXT_KEY = "" as I18nKey;

/** Editor-side seeds of a core action's arguments: a valid starting point, not a server default. */
const CORE_SEEDS: Record<string, Record<string, unknown>> = {
  give_item: { material: "DIAMOND" },
  take_item: { material: "DIAMOND" },
  play_sound: { sound: "ENTITY_EXPERIENCE_ORB_PICKUP" },
  teleport: { location: "world 0 64 0" },
  chat_button: { label: "[OK]", do: [] },
  give_xp: { amount: 1 },
  give_level: { amount: 1 },
  set_arg: { value: '""' },
  set_arg_cycle_next: { list: "[]" },
  set_arg_cycle_prev: { list: "[]" },
};

export function defaultDeclaredAction(
  decl: DeclaredAction,
  options: { firstMenuId?: MenuId; literalText?: boolean } = {},
): Action {
  const seed = CORE_SEEDS[decl.name] ?? {};
  const value: Record<string, unknown> = {};
  for (const arg of decl.args) {
    if (seed[arg.name] !== undefined) value[arg.name] = seed[arg.name];
    else if (arg.type.kind === "document_ref" && arg.type.document === "menu" && arg.required)
      value[arg.name] = options.firstMenuId ?? "";
    else if (arg.default !== undefined) value[arg.name] = arg.default;
    else if (arg.required && arg.type.kind === "ltext" && !options.literalText)
      value[arg.name] = { key: UNALLOCATED_LTEXT_KEY };
    else if (arg.required) value[arg.name] = defaultValueForModelType(arg.type);
  }
  return { name: decl.name, value: canonicalActionValue(decl, value) };
}

/** The seed of a core action by name; an unknown name is the bare action. */
export function defaultAction(name: string, firstMenuId?: MenuId): Action {
  const decl = coreActionOf(name);
  return decl ? defaultDeclaredAction(decl, { firstMenuId }) : { name, value: null };
}

/** The core actions offered by the "+ Add action" picker, in the table's order. */
export const ACTION_TYPES: string[] = CORE_ACTIONS.map((a) => a.name);
