import type { Action, ClickType, Condition } from "@/domain/types";

/** Short label for a click action's discriminator. */
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
    case "show_title":
      return "title";
    case "give_item":
      return "give";
    case "take_money":
      return "$";
    case "paginate":
      return "page";
    case "set_arg":
      return "set";
    case "set_arg_cycle_next":
      return "next";
    case "set_arg_cycle_prev":
      return "prev";
    case "open_dialog":
      return "dialog";
    case "close_dialog":
      return "close_dlg";
  }
}

/** One-line summary of a visibility / requirement predicate. */
export function conditionSummary(condition: Condition): string {
  switch (condition.type) {
    case "has_permission":
      return `has perm "${condition.perm}"`;
    case "has_money":
      return `has $${condition.amount}`;
    case "placeholder_equals":
      return `${condition.placeholder} = "${condition.value}"`;
    case "placeholder_match":
      return `${condition.placeholder} ~ /${condition.regex}/`;
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

/** Stable ordering for click-type sections — left-to-right reading order. */
export const CLICK_TYPE_ORDER: ClickType[] = [
  "left",
  "right",
  "shift_left",
  "shift_right",
  "middle",
];
