import type { AstNode } from "./ast";
import { compare, looseEq, toBoolean, toNumber, toStringValue } from "./coercion";
import { formatDuration } from "./duration";
import type { Scope } from "./scope";

/**
 * Evaluate an AST against a scope. Returns the runtime value (string,
 * number, boolean, null, undefined, array, or object). Caller is
 * responsible for any final coercion (e.g. toBoolean for condition.expr,
 * toStringValue for inline template segments).
 *
 * Errors are NOT thrown for missing data (we return undefined) — this
 * matches the runtime philosophy of "tolerant by default" in spec §3.4.
 * Type errors (e.g. .join on a number) are signaled by returning a safe
 * default; the caller may surface them in the editor's lint pass.
 */
export function evaluate(node: AstNode, scope: Scope): unknown {
  switch (node.kind) {
    case "literal":
      return node.value;
    case "identifier":
      return scope.lookup(node.name);
    case "papi":
      return scope.papi(node.placeholder);
    case "path": {
      const target = evaluate(node.target, scope);
      if (target === null || target === undefined) return undefined;
      if (typeof target !== "object") return undefined;
      return (target as Record<string, unknown>)[node.field];
    }
    case "index": {
      const target = evaluate(node.target, scope);
      const index = evaluate(node.index, scope);
      if (target === null || target === undefined) return undefined;
      if (Array.isArray(target)) {
        const n = typeof index === "number" ? index : Number(index);
        return Number.isInteger(n) ? target[n] : undefined;
      }
      if (typeof target === "object") {
        return (target as Record<string, unknown>)[String(index)];
      }
      return undefined;
    }
    case "method": {
      const target = evaluate(node.target, scope);
      const args = node.args.map((a) => evaluate(a, scope));
      return invokeMethod(target, node.method, args, scope);
    }
    case "unary": {
      const v = evaluate(node.operand, scope);
      return !toBoolean(v);
    }
    case "binary": {
      // Short-circuit for && / ||
      if (node.op === "&&") {
        const l = evaluate(node.left, scope);
        return toBoolean(l) ? toBoolean(evaluate(node.right, scope)) : false;
      }
      if (node.op === "||") {
        const l = evaluate(node.left, scope);
        return toBoolean(l) ? true : toBoolean(evaluate(node.right, scope));
      }
      const left = evaluate(node.left, scope);
      const right = evaluate(node.right, scope);
      switch (node.op) {
        case "+": {
          if (typeof left === "string" || typeof right === "string") {
            return toStringValue(left) + toStringValue(right);
          }
          const ln = toNumber(left);
          const rn = toNumber(right);
          if (ln !== null && rn !== null) return ln + rn;
          return null;
        }
        case "-": {
          if (typeof left === "string" && !Array.isArray(left)) {
            return null;
          }
          const ln = toNumber(left);
          const rn = toNumber(right);
          if (ln !== null && rn !== null) return ln - rn;
          return null;
        }
        case "==":
          return looseEq(left, right);
        case "!=":
          return !looseEq(left, right);
        case "<":
        case "<=":
        case ">":
        case ">=":
          return compare(left, right, node.op);
      }
      return null;
    }
    case "ternary": {
      const c = evaluate(node.cond, scope);
      return toBoolean(c) ? evaluate(node.whenTrue, scope) : evaluate(node.whenFalse, scope);
    }
    default:
      throw new Error(`evaluator: kind '${(node as { kind: string }).kind}' not yet implemented`);
  }
}

function invokeMethod(target: unknown, method: string, args: unknown[], scope: Scope): unknown {
  switch (method) {
    case "join": {
      if (!Array.isArray(target)) return "";
      const sep = args[0] === undefined ? "" : String(args[0]);
      return target.map((x) => (x === null || x === undefined ? "" : String(x))).join(sep);
    }
    case "length": {
      if (target === null || target === undefined) return 0;
      if (Array.isArray(target)) return target.length;
      if (typeof target === "string") return target.length;
      return 0;
    }
    case "first": {
      if (!Array.isArray(target) || target.length === 0) return null;
      return target[0];
    }
    case "last": {
      if (!Array.isArray(target) || target.length === 0) return null;
      return target[target.length - 1];
    }
    case "at": {
      if (!Array.isArray(target)) return null;
      const n = typeof args[0] === "number" ? args[0] : Number(args[0]);
      if (!Number.isInteger(n)) return null;
      const v = target[n];
      return v === undefined ? null : v;
    }
    case "contains": {
      if (!Array.isArray(target)) return false;
      return target.some((x) => x === args[0]);
    }
    case "pluck": {
      if (!Array.isArray(target)) return [];
      const field = args[0] === undefined ? "" : String(args[0]);
      return target.map((x) =>
        x !== null && typeof x === "object"
          ? ((x as Record<string, unknown>)[field] ?? null)
          : null,
      );
    }
    case "until": {
      // The target is an absolute instant (epoch millis) — rows carry the fact,
      // the template decides how it reads (ADR `expression-parity` §6).
      const at = toNumber(target);
      if (at === null) return "";
      return formatDuration(at - scope.now(), (key) => scope.translate(key));
    }
    case "ago": {
      // The mirror of until(): time elapsed since a past instant (`{player.last_seen.ago()}`).
      const at = toNumber(target);
      if (at === null) return "";
      return formatDuration(scope.now() - at, (key) => scope.translate(key));
    }
    case "duration": {
      // A length of time in milliseconds (`{player.playtime.duration()}`), same units as until().
      const ms = toNumber(target);
      if (ms === null) return "";
      return formatDuration(ms, (key) => scope.translate(key));
    }
    default:
      return null;
  }
}
