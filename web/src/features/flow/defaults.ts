import type { Action, MenuId } from "@/domain/types";

/**
 * Sensible-empty Action seed for "+ Add action" pickers. Open-menu picks
 * the first menu the caller passes (so the user immediately has a valid
 * dangling-ref-free action) but falls back to a placeholder if the pack
 * has no menus yet.
 */
export function defaultAction(type: Action["type"], firstMenuId?: MenuId): Action {
  switch (type) {
    case "open_menu":
      return { type: "open_menu", menuId: firstMenuId ?? ("" as MenuId) };
    case "close_menu":
      return { type: "close_menu" };
    case "run_command":
      return { type: "run_command", command: "", as: "player" };
    case "send_message":
      return { type: "send_message", text: "" };
    case "give_item":
      return { type: "give_item", material: "DIAMOND", count: 1 };
    case "take_money":
      return { type: "take_money", amount: 0 };
  }
}

export const ACTION_TYPES: Action["type"][] = [
  "open_menu",
  "close_menu",
  "run_command",
  "send_message",
  "give_item",
  "take_money",
];
