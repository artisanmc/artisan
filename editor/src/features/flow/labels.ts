import type { Action, ClickType, Condition } from "@/domain/types";

/** Short label for a click action's discriminator. */
export function actionTypeLabel(type: Action["type"]): string {
  switch (type) {
    case "open_menu":
      return "menu";
    case "close_menu":
      return "close";
    case "open_previous_menu":
      return "back";
    case "run_command":
      return "cmd";
    case "send_message":
      return "msg";
    case "show_title":
      return "title";
    case "give_item":
      return "give";
    case "take_item":
      return "take";
    case "take_money":
      return "-$";
    case "give_money":
      return "+$";
    case "give_xp":
      return "xp";
    case "give_level":
      return "lvl";
    case "broadcast":
      return "bcast";
    case "play_sound":
      return "sound";
    case "teleport":
      return "tp";
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
    case "run_actions":
      return "run";
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
    case "has_item":
      return `has ${condition.count}× ${condition.material}`;
    case "has_xp":
      return `has ${condition.amount} xp`;
    case "has_level":
      return `level ≥ ${condition.level}`;
    case "world_is":
      return `world = "${condition.world}"`;
    case "time_is":
      return typeof condition.range === "string"
        ? `time is ${condition.range}`
        : `time in ${condition.range.from_ticks}–${condition.range.to_ticks}`;
    case "random_chance":
      return `chance ${Math.round(condition.probability * 100)}%`;
    case "cooldown_passed":
      return `cooldown "${condition.cooldown_id}" passed`;
    case "player_in_region":
      return `in region "${condition.region}"`;
    case "pagination_at_first":
      return condition.elementId ? `first page of ${condition.elementId}` : "on first page";
    case "pagination_at_last":
      return condition.elementId ? `last page of ${condition.elementId}` : "on last page";
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
