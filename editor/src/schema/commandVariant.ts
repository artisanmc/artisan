// A command's file in a variant (design `variantes-modules` §17), the editor's twin of the
// plugin's `CommandVariant`: only what runs (`actions`, `requirements`, `fallback`), on the
// module's command, sub-commands found by `name`. What is registered stays the module's.
//
// Read: the module's file + the variant's → a full command, edited like any other.
// Write: the full command − the module's → only the steps that differ.

type Json = Record<string, unknown>;

/** What a variant may set on a node, the root included. */
export const COMMAND_VARIANT_STEPS = ["actions", "requirements", "fallback"] as const;

const isMap = (v: unknown): v is Json => !!v && typeof v === "object" && !Array.isArray(v);
const norm = (name: unknown) => (typeof name === "string" ? name.trim().toLowerCase() : "");

/**
 * [base] (the module's file) with the steps of [raw] (the variant's); null when [raw] sets
 * anything else, as the plugin refuses it then (`variant_command_key`/`_node`).
 */
export function mergeCommandVariant(base: Json, raw: Json): Json | null {
  for (const key of Object.keys(raw))
    if (key !== "schema" && key !== "subcommands" && !isStep(key)) return null;
  const merged = mergeNode(base, raw, true);
  return merged;
}

function isStep(key: string): boolean {
  return (COMMAND_VARIANT_STEPS as readonly string[]).includes(key);
}

function mergeNode(base: Json, raw: Json, root: boolean): Json | null {
  // The root's legacy `steps` would win over the variant's `actions` on read.
  const { steps: legacy, ...rest } = base;
  const out: Json = root && "actions" in raw && legacy !== undefined ? rest : { ...base };
  for (const key of COMMAND_VARIANT_STEPS) if (key in raw) out[key] = raw[key];
  if (raw.subcommands === undefined) return out;
  if (!Array.isArray(raw.subcommands)) return null;
  const subs = Array.isArray(base.subcommands) ? (base.subcommands as unknown[]) : [];
  const byName = new Map<string, Json>();
  for (const entry of raw.subcommands) {
    if (!isMap(entry)) return null;
    const name = norm(entry.name);
    if (!name || byName.has(name) || !subs.some((s) => isMap(s) && norm(s.name) === name))
      return null;
    for (const key of Object.keys(entry))
      if (key !== "name" && key !== "subcommands" && !isStep(key)) return null;
    byName.set(name, entry);
  }
  const children: unknown[] = [];
  for (const sub of subs) {
    const over = isMap(sub) ? byName.get(norm(sub.name)) : undefined;
    if (!over) {
      children.push(sub);
      continue;
    }
    const merged = mergeNode(sub as Json, over, false);
    if (!merged) return null;
    children.push(merged);
  }
  out.subcommands = children;
  return out;
}

/**
 * What a variant's file holds for [full] (its command as edited) on [base] (the module's):
 * the steps that differ, node by node; a step the module has and the version dropped is
 * written empty. Sub-commands the module does not have are left out (registration is the
 * module's).
 */
export function commandVariantOverlay(base: Json, full: Json): Json {
  return { schema: full.schema ?? base.schema ?? "command/v1", ...overlayNode(base, full) };
}

function overlayNode(base: Json, full: Json): Json {
  const out: Json = {};
  for (const key of COMMAND_VARIANT_STEPS) {
    const b = key === "actions" ? (base.actions ?? base.steps) : base[key];
    const f = full[key];
    if (same(b ?? emptyOf(key), f ?? emptyOf(key))) continue;
    out[key] = f ?? emptyOf(key);
  }
  const subs = Array.isArray(full.subcommands) ? full.subcommands : [];
  const baseSubs = Array.isArray(base.subcommands) ? base.subcommands : [];
  const children: Json[] = [];
  for (const sub of subs) {
    if (!isMap(sub)) continue;
    const twin = baseSubs.find((b) => isMap(b) && norm(b.name) === norm(sub.name));
    if (!isMap(twin)) continue;
    const child = overlayNode(twin, sub);
    if (Object.keys(child).length > 0) children.push({ name: sub.name, ...child });
  }
  if (children.length > 0) out.subcommands = children;
  return out;
}

function emptyOf(key: string): unknown {
  return key === "fallback" ? null : [];
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
}

function sorted(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sorted);
  if (isMap(v))
    return Object.fromEntries(
      Object.keys(v)
        .sort()
        .map((k) => [k, sorted(v[k])]),
    );
  return v;
}
