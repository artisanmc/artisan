import { COMPARISON_OPS, type ComparisonOp } from "./tryParseAsComparison";

/**
 * An `expression` condition read as a criterion on a module Variable (ADR
 * `triggers-and-variables` §10): variable → key → operator → value. The editor writes plain
 * expressions, so a file stays readable and the server needs no new condition:
 *
 * - `var.guilds.has_guild` (is true), `!var.guilds.has_guild` (is false);
 * - `var.guilds.level >= 3`, `var.quests.status["daily/miner"] == "completed"`.
 *
 * `var.` alone is a criterion whose variable is not picked yet.
 */
export interface VariableCondition {
  /** `<module>.<name>`; "" while none is picked. */
  name: string;
  /** The key of a keyed variable, as typed; null: none. */
  key: string | null;
  /** `is` / `is_not`: a boolean read bare or negated. */
  op: "is" | "is_not" | ComparisonOp;
  /** The compared value: a string, number or boolean; null with `is` / `is_not`. */
  value: string | number | boolean | null;
}

const NAME = "[a-z][a-z0-9_-]*\\.[a-z][a-z0-9_]*";
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

/** The expression a criterion writes. */
export function serializeVariableCondition(c: VariableCondition): string {
  const path = `var.${c.name}${c.key === null ? "" : `[${quote(c.key)}]`}`;
  if (c.op === "is") return path;
  if (c.op === "is_not") return `!${path}`;
  const value = c.value ?? "";
  return `${path} ${c.op} ${typeof value === "string" ? quote(value) : String(value)}`;
}

/** True when `expr` is a criterion on a Variable: the condition editor shows it as one. */
export const isVariableCondition = (expr: string): boolean => parseVariableCondition(expr) !== null;
