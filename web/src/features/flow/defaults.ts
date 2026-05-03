import type { Action, I18nKey, MenuId } from "@/domain/types";

/**
 * Sensible-empty Action seed for "+ Add action" pickers. Open-menu picks
 * the first menu the caller passes (so the user immediately has a valid
 * dangling-ref-free action) but falls back to a placeholder if the pack
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
    case "run_command":
      return { type: "run_command", command: "", as: "player" };
    case "send_message":
      return { type: "send_message", text: { key: UNALLOCATED_LTEXT_KEY } };
    case "give_item":
      return { type: "give_item", material: "DIAMOND", count: 1 };
    case "take_money":
      return { type: "take_money", amount: 0 };
    case "paginate":
      return { type: "paginate", direction: "next" };
    case "set_arg":
      return { type: "set_arg", arg: "", value: '""' };
    case "set_arg_cycle_next":
      return { type: "set_arg_cycle_next", arg: "", list: "[]" };
    case "set_arg_cycle_prev":
      return { type: "set_arg_cycle_prev", arg: "", list: "[]" };
  }
}

export const ACTION_TYPES: Action["type"][] = [
  "open_menu",
  "close_menu",
  "run_command",
  "send_message",
  "give_item",
  "take_money",
  "paginate",
  "set_arg",
  "set_arg_cycle_next",
  "set_arg_cycle_prev",
];
