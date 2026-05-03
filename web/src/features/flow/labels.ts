import type { Action, ClickType, Condition } from "@/domain/types";

/** One-line summary of a click action — used as the card label in the flow canvas. */
export function actionSummary(action: Action): string {
  switch (action.type) {
    case "open_menu":
      return `Open ${action.menuId}${action.clearContext ? " (clear)" : ""}`;
    case "close_menu":
      return "Close menu";
    case "run_command":
      return `${action.as === "console" ? "[CONSOLE] " : ""}/${action.command}`;
    case "send_message":
      return `Send · ${truncate(action.text, 40)}`;
    case "give_item":
      return `Give ${action.count}× ${action.material}`;
    case "take_money":
      return `Take $${action.amount}`;
    case "set_arg":
      return `Set ${action.arg} = ${action.value}`;
  }
}

/** Short label for a click action's discriminator (drives the card icon). */
export function actionTypeLabel(type: Action["type"]): string {
  switch (type) {
    case "open_menu":
      return "menu";
    case "close_menu":
      return "close";
    case "run_command":
      return "cmd";
    case "send_message":
      return "msg";
    case "give_item":
      return "give";
    case "take_money":
      return "$";
    case "set_arg":
      return "set";
  }
}

/** One-line summary of a visibility / requirement predicate. */
export function conditionSummary(condition: Condition): string {
  switch (condition.type) {
    case "has_permission":
      return `has perm "${condition.perm}"`;
    case "has_money":
      return `has $${condition.amount}`;
    case "not":
      return `NOT (${conditionSummary(condition.of)})`;
    case "and":
      return condition.of.length <= 1
        ? condition.of.map(conditionSummary).join("")
        : `(${condition.of.map(conditionSummary).join(" AND ")})`;
    case "or":
      return condition.of.length <= 1
        ? condition.of.map(conditionSummary).join("")
        : `(${condition.of.map(conditionSummary).join(" OR ")})`;
    case "expression":
      return `expr(${condition.expr})`;
  }
}

/** Human-readable label for a click type. */
export function clickTypeLabel(type: ClickType): string {
  switch (type) {
    case "left":
      return "Left";
    case "right":
      return "Right";
    case "shift_left":
      return "Shift+Left";
    case "shift_right":
      return "Shift+Right";
    case "middle":
      return "Middle";
  }
}

/** Stable ordering for click-type columns — left-to-right reading order. */
export const CLICK_TYPE_ORDER: ClickType[] = [
  "left",
  "right",
  "shift_left",
  "shift_right",
  "middle",
];

const truncate = (s: string, max: number): string =>
  s.length > max ? `${s.slice(0, max - 1)}…` : s;
