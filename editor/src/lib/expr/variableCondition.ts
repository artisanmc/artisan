import type { Condition } from "@/domain/types";
import { COMPARISON_OPS, type ComparisonOp } from "./tryParseAsComparison";

/**
 * A condition read as a criterion on a Variable (ADR `triggers-and-variables` §5, §10):
 * variable → key → operator → value. The editor writes plain expressions, so a file stays
 * readable, and `has_var` for "is set":
 *
 * - `var.guilds.has_guild` (is true), `!var.guilds.has_guild` (is false), `var.vip` for a
 *   boolean Project variable;
 * - `var.guilds.level >= 3`, `var.quests.status["daily/miner"] == "completed"`, `var.coins >= 10`;
 * - `has_var: last_death` (a value is stored).
 *
 * `var.` alone is a criterion whose variable is not picked yet.
 */
export interface VariableCondition {
  /** A Project variable's id, or `<module>.<name>`; "" while none is picked. */
  name: string;
  /** The key of a keyed variable, as typed; null: none. */
  key: string | null;
  /** `is` / `is_not`: a boolean read bare or negated; `is_set`: `has_var`. */
  op: "is" | "is_not" | "is_set" | ComparisonOp;
  /** The compared value: a string, number or boolean; null with `is` / `is_not`. */
  value: string | number | boolean | null;
}

const NAME = "[a-z][a-z0-9_-]*(?:\\.[a-z][a-z0-9_]*)?";
const KEY = '\\["((?:[^"\\\\]|\\\\.)*)"\\]';
const SHAPE = new RegExp(`^(!)?var\\.(${NAME})?(?:${KEY})?(?:\\s*(==|!=|<=|>=|<|>)\\s*(.+))?$`);

function literal(raw: string): string | number | boolean | null {
  const s = raw.trim();
  if (s === "true") return true;
  if (s === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  const m = /^"((?:[^"\\]|\\.)*)"$/.exec(s);
  return m ? m[1]!.replace(/\\(.)/g, "$1") : null;
}

/** `expr` as a criterion on a Variable, or null when it is any other expression. */
export function parseVariableCondition(expr: string): VariableCondition | null {
  const m = SHAPE.exec(expr.trim());
  if (!m) return null;
  const [, negated, name = "", rawKey, op, rawValue] = m;
  const key = rawKey === undefined ? null : rawKey.replace(/\\(.)/g, "$1");
  if (op === undefined) return { name, key, op: negated ? "is_not" : "is", value: null };
  if (negated) return null;
  const value = literal(rawValue!);
  if (value === null || !(COMPARISON_OPS as readonly string[]).includes(op)) return null;
  return { name, key, op: op as ComparisonOp, value };
}

const quote = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

/** `has_var`'s argument as a criterion "is set", or null when it names no Variable. */
export function parseHasVar(name: string): VariableCondition | null {
  const m = new RegExp(`^(${NAME})(?:${KEY})?$`).exec(name.trim());
  if (!m) return name.trim() === "" ? { name: "", key: null, op: "is_set", value: null } : null;
  return {
    name: m[1]!,
    key: m[2] === undefined ? null : m[2].replace(/\\(.)/g, "$1"),
    op: "is_set",
    value: null,
  };
}

/** A condition as a criterion on a Variable, or null when it is another condition. */
export function variableCriterionOf(c: Condition): VariableCondition | null {
  if (c.type === "has_var") return parseHasVar(c.var);
  if (c.type === "expression") return parseVariableCondition(c.expr);
  return null;
}

/** The condition a criterion writes: `has_var` for "is set", an expression otherwise. */
export function conditionOfCriterion(c: VariableCondition): Condition {
  if (c.op === "is_set") {
    return { type: "has_var", var: `${c.name}${c.key === null ? "" : `[${quote(c.key)}]`}` };
  }
  return { type: "expression", expr: serializeVariableCondition(c) };
}

/** The expression a criterion writes (`is_set` aside: see {@link conditionOfCriterion}). */
export function serializeVariableCondition(c: VariableCondition): string {
  const path = `var.${c.name}${c.key === null ? "" : `[${quote(c.key)}]`}`;
  if (c.op === "is" || c.op === "is_set") return path;
  if (c.op === "is_not") return `!${path}`;
  const value = c.value ?? "";
  return `${path} ${c.op} ${typeof value === "string" ? quote(value) : String(value)}`;
}

/** True when `expr` is a criterion on a Variable: the condition editor shows it as one. */
export const isVariableCondition = (expr: string): boolean => parseVariableCondition(expr) !== null;
