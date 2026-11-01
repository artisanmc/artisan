import type { ModelField } from "@/domain/types";
import { apiFetch } from "./client";

/**
 * A read-only value a module declares (ADR `triggers-and-variables` §10), read in conditions
 * and texts as `var.<module>.<name>`. Wire verbatim from `declared_variables` at Presence.
 */
export interface ModuleVariable {
  /** `<module>.<name>`: what `var.` is followed by. */
  name: string;
  type: "string" | "number" | "boolean" | "location";
  scope: "player" | "server";
  /** Closed values the module declares (a string only); empty: any. */
  values: string[];
  /** The key's field, for a variable read per key (`var.quests.status["daily/miner"]`). */
  key: ModelField | null;
  /** What the value is, by language code. */
  description: Record<string, string>;
  moduleId: string;
}

interface ModuleVariableWire {
  name?: string;
  type?: string;
  scope?: string;
  values?: string[];
  key?: ModelField | null;
  description?: Record<string, string>;
  module_id?: string;
}

/** One `declared_variables` entry, or null when it has no `<module>.<name>` name. */
export function moduleVariableFromWire(w: ModuleVariableWire): ModuleVariable | null {
  if (typeof w.name !== "string" || !/^[a-z][a-z0-9_-]*\.[a-z][a-z0-9_]*$/.test(w.name))
    return null;
  const type =
    w.type === "number" || w.type === "boolean" || w.type === "location" ? w.type : "string";
  return {
    name: w.name,
    type,
    scope: w.scope === "server" ? "server" : "player",
    values: Array.isArray(w.values) ? w.values.filter((v) => typeof v === "string") : [],
    key: w.key ?? null,
    description: w.description ?? {},
    moduleId: w.module_id ?? w.name.split(".")[0]!,
  };
}

/** Module Variables of a server. [] on any failure. */
export async function fetchServerVariables(serverId: string): Promise<ModuleVariable[]> {
  try {
    const data = await apiFetch<{ variables?: ModuleVariableWire[] }>(
      `/api/v1/servers/${serverId}/variables`,
    );
    return (data.variables ?? []).flatMap((w) => moduleVariableFromWire(w) ?? []);
  } catch {
    return [];
  }
}
