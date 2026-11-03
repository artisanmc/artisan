import type { ProjectId } from "@/domain/types";

/**
 * A Project variable (`variables/<id>.yml`, `schema: variable/v1`, ADR `triggers-and-variables`
 * §5): a named, typed value that chains write (`set_var`, `add_var`, `clear_var`) and that
 * conditions and texts read as `{var.<id>}`.
 */
export type VariableType = "string" | "number" | "boolean" | "location";
export type VariableScope = "player" | "server";

export interface Variable {
  id: string;
  projectId: ProjectId;
  scope: VariableScope;
  type: VariableType;
  /** Read while nothing is stored; absent: none. */
  default?: unknown;
  /** Lifetime after the last write; absent: never expires. */
  expiresSeconds?: number;
  /** Keys the editor does not edit (`notes`…), written back as read. */
  wire?: Record<string, unknown>;
}

export const VARIABLE_KIND = {
  kind: "variable",
  dir: "variables",
  idPrefix: "v_",
  schemaVersion: "variable/v1",
  rank: 4,
} as const;

export const VARIABLE_TYPES: readonly VariableType[] = ["string", "number", "boolean", "location"];

const MODELLED = new Set(["schema", "id", "scope", "type", "default", "expires_seconds"]);

/** `variable/v1` → Variable; an unknown type reads as `string`, kept as written by the next save only if edited. */
export function variableFromFile(src: Record<string, unknown>, projectId: string): Variable {
  const type = VARIABLE_TYPES.includes(src.type as VariableType)
    ? (src.type as VariableType)
    : "string";
  const expires = Number(src.expires_seconds);
  const wire = Object.fromEntries(Object.entries(src).filter(([k]) => !MODELLED.has(k)));
  return {
    id: String(src.id ?? ""),
    projectId: projectId as ProjectId,
    scope: src.scope === "server" ? "server" : "player",
    type,
    ...(src.default !== undefined && src.default !== null ? { default: src.default } : {}),
    ...(Number.isFinite(expires) && expires > 0 ? { expiresSeconds: Math.floor(expires) } : {}),
    ...(Object.keys(wire).length > 0 ? { wire } : {}),
  };
}

/** Variable → canonical `variable/v1`, `id` included (the host strips it). */
export function variableToFile(v: Variable): Record<string, unknown> {
  return {
    schema: VARIABLE_KIND.schemaVersion,
    id: v.id,
    ...(v.scope === "server" ? { scope: "server" } : {}),
    type: v.type,
    ...(v.default !== undefined ? { default: v.default } : {}),
    ...(v.expiresSeconds ? { expires_seconds: v.expiresSeconds } : {}),
    ...v.wire,
  };
}

/** Whether `value` is a value of `type`, as the server accepts it (a default, a literal `set_var`). */
export function acceptsValue(type: VariableType, value: unknown): boolean {
  switch (type) {
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "boolean":
      return typeof value === "boolean";
    case "location":
      if (typeof value === "string")
        return /^\S+(?:[\s,]+-?\d+(?:\.\d+)?){3}(?:(?:[\s,]+-?\d+(?:\.\d+)?){2})?$/.test(
          value.trim(),
        );
      return (
        !!value &&
        typeof value === "object" &&
        typeof (value as Record<string, unknown>).world === "string" &&
        ["x", "y", "z"].every((k) => typeof (value as Record<string, unknown>)[k] === "number")
      );
  }
}
