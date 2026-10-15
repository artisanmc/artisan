import { defaultValueForModelType } from "@/domain/dataModels";
import type { Action, DialogId, I18nKey, MenuId } from "@/domain/types";
import type { DeclaredAction } from "@/lib/api/declaredActions";

/**
 * Sensible-empty Action seed for "+ Add action" pickers. Open-menu picks
 * the first menu the caller passes (so the user immediately has a valid
 * dangling-ref-free action) but falls back to a placeholder if the project
 * has no menus yet.
 *
 * For `send_message` we emit an empty-key LText sentinel; the store
 * mutator that performs the insertion detects this and allocates a fresh
 * i18n key, so the caller doesn't need draft access here.
 */
export const UNALLOCATED_LTEXT_KEY = "" as I18nKey;
export function defaultAction(type: Action["type"], firstMenuId?: MenuId): Action {
  switch (type) {
    case "open_menu":
      return { type: "open_menu", menuId: firstMenuId ?? ("" as MenuId) };
    case "close_menu":
      return { type: "close_menu" };
    case "open_previous_menu":
      return { type: "open_previous_menu" };
    case "run_command":
      return { type: "run_command", command: "", as: "player" };
    case "send_message":
      return { type: "send_message", text: { key: UNALLOCATED_LTEXT_KEY } };
    case "show_title":
      return { type: "show_title", title: { key: UNALLOCATED_LTEXT_KEY } };
    case "give_item":
      return { type: "give_item", material: "DIAMOND", count: 1 };
    case "take_item":
      return { type: "take_item", material: "DIAMOND", count: 1 };
    case "take_money":
      return { type: "take_money", amount: 0 };
    case "give_money":
      return { type: "give_money", amount: 0 };
    case "give_xp":
      return { type: "give_xp", amount: 1 };
    case "give_level":
      return { type: "give_level", amount: 1 };
    case "broadcast":
      return { type: "broadcast", text: { key: UNALLOCATED_LTEXT_KEY } };
    case "play_sound":
      return { type: "play_sound", sound: "ENTITY_EXPERIENCE_ORB_PICKUP" };
    case "teleport":
      return { type: "teleport", world: "world", x: 0, y: 64, z: 0 };
    case "paginate":
      return { type: "paginate", direction: "next" };
    case "set_arg":
      return { type: "set_arg", arg: "", value: '""' };
    case "set_arg_cycle_next":
      return { type: "set_arg_cycle_next", arg: "", list: "[]" };
    case "set_arg_cycle_prev":
      return { type: "set_arg_cycle_prev", arg: "", list: "[]" };
    case "open_dialog":
      return { type: "open_dialog", dialogId: "" as DialogId };
    case "close_dialog":
      return { type: "close_dialog" };
    case "run_actions":
      return { type: "run_actions", actions: "" };
    case "module":
      // Seeded from a declaration by `defaultModuleAction`; a bare type has no name yet.
      return { type: "module", name: "", value: null };
  }
}

/**
 * The seed of a module-declared action (ADR `extensible-document-kinds`, R1): every
 * argument that carries a default or is required starts set, so the chain the
 * editor writes is what the server binds. No argument → the bare name.
 */
export function defaultModuleAction(decl: DeclaredAction): Action {
  const value: Record<string, unknown> = {};
  for (const arg of decl.args) {
    if (arg.default !== undefined) value[arg.name] = arg.default;
    else if (arg.required) value[arg.name] = defaultValueForModelType(arg.type);
  }
  const keys = Object.keys(value);
  if (keys.length === 0) return { type: "module", name: decl.name, value: null };
  if (decl.primary && keys.length === 1 && keys[0] === decl.primary)
    return { type: "module", name: decl.name, value: value[decl.primary] };
  return { type: "module", name: decl.name, value };
}

export const ACTION_TYPES: Action["type"][] = [
  "open_menu",
  "close_menu",
  "open_previous_menu",
  "run_command",
  "send_message",
  "broadcast",
  "show_title",
  "play_sound",
  "give_item",
  "take_item",
  "take_money",
  "give_money",
  "give_xp",
  "give_level",
  "teleport",
  "paginate",
  "set_arg",
  "set_arg_cycle_next",
  "set_arg_cycle_prev",
  "open_dialog",
  "close_dialog",
  "run_actions",
];
