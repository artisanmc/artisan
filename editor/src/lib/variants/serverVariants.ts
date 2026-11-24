import { getServerConfig } from "@/lib/api/serverConfig";

/** The config key of the server's own menu variants (`config.yml`). */
export const MENU_VARIANTS_KEY = "menu-variants";

/** The variants every server has (design `variantes-modules`, variants declared by the server). */
export const BUILTIN_VARIANTS = ["default", "bedrock", "textured"] as const;

/** `auto` is the player's "no choice", never a variant's name. */
const RESERVED = new Set<string>([...BUILTIN_VARIANTS, "auto"]);

/** A variant's name, the same as a module's `variants/<name>/` folder (`ServerVariants.NAME`). */
export const SERVER_VARIANT_NAME = /^[a-z0-9][a-z0-9_-]{0,31}$/;

/** One entry of `menu-variants`. */
export interface ServerVariant {
  name: string;
  /** The variant a module without a version of a file falls back to. */
  parent: string;
  /** Conditions of an action's `if` (keyed wire), all required; empty: only by choice. */
  if: unknown[];
  /** False: never offered by `/artisan variant`. */
  selectable: boolean;
}

/** `menu-variants` as reported by the plugin → the form's entries; anything malformed is skipped. */
export function serverVariantsFromConfig(raw: unknown): ServerVariant[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item): ServerVariant[] => {
    if (!item || typeof item !== "object") return [];
    const m = item as Record<string, unknown>;
    if (typeof m.name !== "string") return [];
    const conditions = m.if === undefined || m.if === null ? [] : [m.if].flat();
    return [
      {
        name: m.name,
        parent: typeof m.parent === "string" && m.parent ? m.parent : "default",
        if: conditions,
        selectable: m.selectable !== false,
      },
    ];
  });
}

/** The entries as `config.yml` keeps them: defaults left out. */
export function serverVariantsToConfig(variants: ServerVariant[]): Record<string, unknown>[] {
  return variants.map((v) => ({
    name: v.name,
    ...(v.parent !== "default" ? { parent: v.parent } : {}),
    ...(v.if.length > 0 ? { if: v.if } : {}),
    ...(v.selectable ? {} : { selectable: false }),
  }));
}

export type ServerVariantProblem = "name" | "builtin" | "duplicate" | "parent" | "loop";

/**
 * What the plugin would refuse in [variants], by index (`ServerVariants.parse`): a bad or taken
 * name, a parent not declared, a loop of parents. The plugin writes nothing while one remains.
 */
export function serverVariantProblems(
  variants: ServerVariant[],
): Map<number, ServerVariantProblem> {
  const out = new Map<number, ServerVariantProblem>();
  const byName = new Map<string, ServerVariant>();
  variants.forEach((v, i) => {
    if (!SERVER_VARIANT_NAME.test(v.name)) out.set(i, "name");
    else if (RESERVED.has(v.name)) out.set(i, "builtin");
    else if (byName.has(v.name)) out.set(i, "duplicate");
    else byName.set(v.name, v);
  });
  variants.forEach((v, i) => {
    if (out.has(i)) return;
    const seen = new Set<string>();
    let current = v.name;
    while (!(BUILTIN_VARIANTS as readonly string[]).includes(current)) {
      if (seen.has(current)) return void out.set(i, "loop");
      seen.add(current);
      const next = byName.get(current)?.parent;
      if (next === undefined) return void out.set(i, "parent");
      current = next;
    }
  });
  return out;
}

/** Every variant name the server declares: the built-in ones, then its own. */
export function serverVariantNames(config: Record<string, unknown> | null): string[] {
  return [
    ...BUILTIN_VARIANTS,
    ...serverVariantsFromConfig(config?.[MENU_VARIANTS_KEY]).map((v) => v.name),
  ];
}

/** One request per server while the page lives; dropped when the configuration is saved. */
const names = new Map<string, Promise<string[] | null>>();

/** The variants [serverId] declares, or null when its configuration cannot be read. */
export function loadServerVariantNames(serverId: string): Promise<string[] | null> {
  let pending = names.get(serverId);
  if (!pending) {
    pending = getServerConfig(serverId)
      .then((res) => (res.config ? serverVariantNames(res.config) : null))
      .catch(() => null);
    names.set(serverId, pending);
  }
  return pending;
}

/** After a server's configuration is written: the next reader asks again. */
export function invalidateServerVariants(): void {
  names.clear();
}
