/**
 * Coercion helpers for the expression evaluator. Centralized here so the
 * rules from spec §1.4 are testable in one place and reused everywhere
 * (operators, ternary condition, expression-condition coercion to bool).
 */

export type ExprValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | ExprValue[]
  | { [key: string]: ExprValue };

export function toBoolean(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (v === false) return false;
  if (v === 0) return false;
  if (v === "") return false;
  return true;
}

export function toNumber(v: unknown): number | null {
  if (typeof v === "number" && !Number.isNaN(v)) return v;
  if (typeof v === "string") {
    const trimmed = v.trim();
    if (trimmed === "") return null;
    const n = Number(trimmed);
    return Number.isNaN(n) ? null : n;
  }
  return null;
}

export function toStringValue(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number") {
    return Number.isInteger(v) ? String(v) : String(v);
  }
  if (typeof v === "boolean") return v ? "true" : "false";
  if (Array.isArray(v)) return v.map((x) => toStringValue(x)).join(",");
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

export function looseEq(a: unknown, b: unknown): boolean {
  const aEmpty = a === null || a === undefined || a === "";
  const bEmpty = b === null || b === undefined || b === "";
  if (aEmpty && bEmpty) return true;
  if (aEmpty || bEmpty) return false;
  const an = toNumber(a);
  const bn = toNumber(b);
  if (an !== null && bn !== null) {
    return an === bn;
  }
  return toStringValue(a) === toStringValue(b);
}

export function compare(a: unknown, b: unknown, op: "<" | "<=" | ">" | ">="): boolean {
  const an = toNumber(a);
  const bn = toNumber(b);
  if (an !== null && bn !== null) {
    switch (op) {
      case "<":
        return an < bn;
      case "<=":
        return an <= bn;
      case ">":
        return an > bn;
      case ">=":
        return an >= bn;
    }
  }
  const as = toStringValue(a);
  const bs = toStringValue(b);
  switch (op) {
    case "<":
      return as < bs;
    case "<=":
      return as <= bs;
    case ">":
      return as > bs;
    case ">=":
      return as >= bs;
  }
}
