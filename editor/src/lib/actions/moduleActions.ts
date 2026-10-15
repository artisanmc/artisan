import type { DeclaredAction } from "@/lib/api/declaredActions";

/**
 * The wire value of a module's action ⇄ its argument map, after the server's
 * `ActionDeclaration.normalize` / `canonical` (ADR `structured-action-wire`): null is
 * no argument, a map whose keys are all declared arguments is the argument map, anything
 * else is the primary argument's value; the editor writes back the shortest form.
 */
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export function normalizeModuleArgs(decl: DeclaredAction, value: unknown): Record<string, unknown> {
  if (value == null) return {};
  if (isRecord(value) && isArgsMap(decl, value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) if (v != null) out[k] = v;
    return out;
  }
  return decl.primary ? { [decl.primary]: value } : {};
}

function isArgsMap(decl: DeclaredAction, map: Record<string, unknown>): boolean {
  if (decl.args.length === 0) return true;
  const keys = Object.keys(map);
  if (keys.length === 0) return decl.primary === null;
  return keys.every((k) => decl.args.some((a) => a.name === k));
}

export function canonicalModuleValue(decl: DeclaredAction, args: Record<string, unknown>): unknown {
  const set: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) if (v !== undefined && v !== null) set[k] = v;
  const keys = Object.keys(set);
  if (keys.length === 0) return null;
  if (decl.primary && keys.length === 1 && keys[0] === decl.primary) return set[decl.primary];
  return set;
}
