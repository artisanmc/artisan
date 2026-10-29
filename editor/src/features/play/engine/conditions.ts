import type { Condition } from "@/domain/types";
import { conditionToStructured } from "@/lib/actions/structuredSteps";
import { toBoolean } from "@/lib/expr/coercion";
import { type TestPlayer, hasPermission } from "./testPlayer";

/** What a condition is evaluated against in the Play mode. */
export interface ConditionEnv {
  player: TestPlayer;
  /** A template (`{arg}`, `%papi%`) rendered in the current scope. */
  render: (template: string) => string;
  /** A free expression's value in the current scope; throws when it cannot be evaluated. */
  evaluate: (expr: string) => unknown;
  /** The open menu's pagination, for `pagination_at_first` / `pagination_at_last`. */
  pagination?: (elementId: string | undefined) => { page: number; totalPages: number } | null;
  /** Told about each condition the preview could not decide (it then took its forced value). */
  onForced?: (key: string, condition: Condition) => void;
}

/** A condition's identity across runs: its wire form. The test player's `forced` is keyed by it. */
export const conditionKey = (c: Condition): string => JSON.stringify(conditionToStructured(c));

/**
 * A condition's value for the test player. What the preview can compute from the player
 * (permission, money, xp, level, world, placeholders, expressions) is computed; the rest
 * (an item in the inventory, a region, the time, chance, a cooldown) takes the value
 * forced on the player, true by default.
 */
export function evalCondition(c: Condition, env: ConditionEnv): boolean {
  const forced = (): boolean => {
    const key = conditionKey(c);
    env.onForced?.(key, c);
    return env.player.forced[key] ?? true;
  };
  switch (c.type) {
    case "has_permission":
      return hasPermission(env.player, c.perm);
    case "has_money":
      return env.player.money >= c.amount;
    case "has_xp":
      return env.player.xp >= c.amount;
    case "has_level":
      return env.player.level >= c.level;
    case "world_is":
      return env.player.world === c.world;
    case "placeholder_equals":
      return env.render(c.placeholder) === env.render(c.value);
    case "placeholder_match":
      try {
        return new RegExp(`^(?:${c.regex})$`).test(env.render(c.placeholder));
      } catch {
        return false;
      }
    case "pagination_at_first":
    case "pagination_at_last": {
      const p = env.pagination?.(c.elementId);
      if (!p) return forced();
      return c.type === "pagination_at_first" ? p.page <= 0 : p.page >= p.totalPages - 1;
    }
    case "not":
      return !evalCondition(c.of, env);
    case "and":
      return c.of.every((x) => evalCondition(x, env));
    case "or":
      return c.of.some((x) => evalCondition(x, env));
    case "expression":
      try {
        return toBoolean(env.evaluate(c.expr));
      } catch {
        return forced();
      }
    default:
      return forced();
  }
}

/**
 * An `if` case: its conditions joined left to right without precedence, as the plugin's
 * `caseMatches` does (`A and B or C` is `(A and B) or C`). No condition: true.
 */
export function caseMatches(
  conditions: readonly Condition[] | undefined,
  joins: readonly ("and" | "or")[] | undefined,
  env: ConditionEnv,
): boolean {
  if (!conditions || conditions.length === 0) return true;
  let acc = evalCondition(conditions[0]!, env);
  for (let i = 1; i < conditions.length; i++) {
    const value = evalCondition(conditions[i]!, env);
    acc = (joins?.[i - 1] ?? "and") === "or" ? acc || value : acc && value;
  }
  return acc;
}
