import type { ClickType, Condition } from "@/domain/types";

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
    case "client_is":
      return `client = ${condition.client}`;
    case "has_resource_pack":
      return "has the resource pack";
    case "time_is":
      return typeof condition.range === "string"
        ? `time is ${condition.range}`
        : `time in ${condition.range.from_ticks}–${condition.range.to_ticks}`;
    case "random_chance":
      return `chance ${Math.round(condition.probability * 100)}%`;
    case "cooldown_passed":
      return `cooldown "${condition.cooldown_id}" passed`;
    case "has_var":
      return `${condition.var} is set`;
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

/** One-line summary of a top-level condition list joined by its AND/OR operators. */
export function conditionsSummary(
  conditions: Condition[],
  joins: ("and" | "or")[] | undefined,
): string {
  return conditions
    .map((c, i) =>
      i === 0
        ? conditionSummary(c)
        : ` ${(joins?.[i - 1] ?? "and").toUpperCase()} ${conditionSummary(c)}`,
    )
    .join("");
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
