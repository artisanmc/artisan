// backend/src/lib/mergeEngine.ts

export type ConflictResolutionKind = "modify-modify" | "delete-modify";

export interface Conflict {
  conflictKey: string;
  collection: string;
  resolution: ConflictResolutionKind;
  srcValue: unknown | null;
  dstValue: unknown | null;
  baseValue: unknown | null;
}

export interface MergeResult {
  mergedState: EditorState;
  conflicts: Conflict[];
}

/**
 * Loose shape of the editor state. Properties used by the merge algorithm
 * are listed explicitly; the catch-all `[key: string]: unknown` lets us
 * preserve unknown fields from dst (forward-compat with the editor schema).
 */
export interface EditorState {
  menus?: Array<{ id: string } & Record<string, unknown>>;
  commands?: Array<{ id: string } & Record<string, unknown>>;
  dialogs?: Array<{ id: string } & Record<string, unknown>>;
  templates?: Array<{ id: string } & Record<string, unknown>>;
  dataSources?: Array<{ id: string } & Record<string, unknown>>;
  i18nKeys?: Record<string, unknown>;
  canvasLayout?: Record<string, unknown>;
  defaultLang?: string;
  name?: string;
  description?: string;
  [key: string]: unknown;
}

const COLLECTIONS_BY_ID = ["menus", "commands", "dialogs", "templates", "dataSources"] as const;
const MAP_COLLECTIONS = ["i18nKeys", "canvasLayout"] as const;
const SCALAR_FIELDS = ["defaultLang", "name", "description"] as const;

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
}

function sortKeys(v: unknown): unknown {
  if (v === null || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map(sortKeys);
  const sorted: Record<string, unknown> = {};
  for (const k of Object.keys(v).sort()) sorted[k] = sortKeys((v as Record<string, unknown>)[k]);
  return sorted;
}

export function merge(
  base: EditorState,
  src: EditorState,
  dst: EditorState,
): MergeResult {
  const merged: EditorState = structuredClone(dst);
  const conflicts: Conflict[] = [];

  // ── Collections by id ───────────────────────────────────────────────
  for (const collection of COLLECTIONS_BY_ID) {
    const baseList = (base[collection] ?? []) as Array<{ id: string }>;
    const srcList = (src[collection] ?? []) as Array<{ id: string }>;
    const dstList = (dst[collection] ?? []) as Array<{ id: string }>;
    const baseMap = new Map(baseList.map((x) => [x.id, x]));
    const srcMap = new Map(srcList.map((x) => [x.id, x]));
    const dstMap = new Map(dstList.map((x) => [x.id, x]));

    const allIds = new Set<string>([...baseMap.keys(), ...srcMap.keys(), ...dstMap.keys()]);
    const result: Array<{ id: string }> = [];
    for (const id of allIds) {
      const itemBase = baseMap.get(id);
      const itemSrc = srcMap.get(id);
      const itemDst = dstMap.get(id);
      const changedSrc = !deepEqual(itemBase, itemSrc);
      const changedDst = !deepEqual(itemBase, itemDst);

      if (!changedSrc && !changedDst) {
        if (itemDst !== undefined) result.push(itemDst);
        continue;
      }
      if (changedSrc && !changedDst) {
        if (itemSrc !== undefined) result.push(itemSrc);
        continue;
      }
      if (!changedSrc && changedDst) {
        if (itemDst !== undefined) result.push(itemDst);
        continue;
      }
      // changedSrc && changedDst
      if (deepEqual(itemSrc, itemDst)) {
        if (itemSrc !== undefined) result.push(itemSrc);
        continue;
      }
      // Conflict
      const isDelete = itemSrc === undefined || itemDst === undefined;
      conflicts.push({
        conflictKey: `${collection}:${id}`,
        collection,
        resolution: isDelete ? "delete-modify" : "modify-modify",
        srcValue: itemSrc ?? null,
        dstValue: itemDst ?? null,
        baseValue: itemBase ?? null,
      });
      // Default in merged = dst's value (so the merged state is renderable)
      if (itemDst !== undefined) result.push(itemDst);
    }
    (merged as Record<string, unknown>)[collection] = result;
  }

  // ── Map collections ─────────────────────────────────────────────────
  for (const collection of MAP_COLLECTIONS) {
    const baseMap = (base[collection] ?? {}) as Record<string, unknown>;
    const srcMap = (src[collection] ?? {}) as Record<string, unknown>;
    const dstMap = (dst[collection] ?? {}) as Record<string, unknown>;

    const allKeys = new Set<string>([...Object.keys(baseMap), ...Object.keys(srcMap), ...Object.keys(dstMap)]);
    const result: Record<string, unknown> = {};
    for (const key of allKeys) {
      const itemBase = key in baseMap ? baseMap[key] : undefined;
      const itemSrc = key in srcMap ? srcMap[key] : undefined;
      const itemDst = key in dstMap ? dstMap[key] : undefined;
      const changedSrc = !deepEqual(itemBase, itemSrc);
      const changedDst = !deepEqual(itemBase, itemDst);

      if (!changedSrc && !changedDst) {
        if (itemDst !== undefined) result[key] = itemDst;
        continue;
      }
      if (changedSrc && !changedDst) {
        if (itemSrc !== undefined) result[key] = itemSrc;
        continue;
      }
      if (!changedSrc && changedDst) {
        if (itemDst !== undefined) result[key] = itemDst;
        continue;
      }
      if (deepEqual(itemSrc, itemDst)) {
        if (itemSrc !== undefined) result[key] = itemSrc;
        continue;
      }
      const isDelete = itemSrc === undefined || itemDst === undefined;
      conflicts.push({
        conflictKey: `${collection}:${key}`,
        collection,
        resolution: isDelete ? "delete-modify" : "modify-modify",
        srcValue: itemSrc ?? null,
        dstValue: itemDst ?? null,
        baseValue: itemBase ?? null,
      });
      if (itemDst !== undefined) result[key] = itemDst;
    }
    (merged as Record<string, unknown>)[collection] = result;
  }

  // ── Scalar fields ───────────────────────────────────────────────────
  for (const field of SCALAR_FIELDS) {
    const vBase = base[field];
    const vSrc = src[field];
    const vDst = dst[field];
    const changedSrc = !deepEqual(vBase, vSrc);
    const changedDst = !deepEqual(vBase, vDst);

    if (!changedSrc && !changedDst) continue;  // already at dst's value in `merged`
    if (changedSrc && !changedDst) {
      (merged as Record<string, unknown>)[field] = vSrc;
      continue;
    }
    if (!changedSrc && changedDst) continue;   // dst's value already in merged
    if (deepEqual(vSrc, vDst)) continue;       // same final value, no conflict
    conflicts.push({
      conflictKey: `scalar:${field}`,
      collection: "scalar",
      resolution: "modify-modify",
      srcValue: vSrc ?? null,
      dstValue: vDst ?? null,
      baseValue: vBase ?? null,
    });
    // merged keeps dst's value (default)
  }

  return { mergedState: merged, conflicts };
}

/**
 * Applies user conflict resolutions to a mergedState produced by `merge()`.
 * Does NOT mutate the input — returns a fresh structuredClone with choices applied.
 *
 * @param mergedState  Output of `merge()` (dst-defaults already baked in)
 * @param conflicts    The conflicts array from `merge()`
 * @param resolutions  Map of conflictKey → "src" | "dst"
 * @throws if a resolution is missing for any conflict, or if a choice value is invalid
 */
export function applyResolutions(
  mergedState: EditorState,
  conflicts: Conflict[],
  resolutions: Record<string, "src" | "dst">,
): EditorState {
  const result = structuredClone(mergedState);

  for (const c of conflicts) {
    const choice = resolutions[c.conflictKey];
    if (choice === undefined) {
      throw new Error(`applyResolutions: missing resolution for ${c.conflictKey}`);
    }
    if (choice !== "src" && choice !== "dst") {
      throw new Error(`applyResolutions: invalid choice "${choice}" for ${c.conflictKey}`);
    }
    const chosenValue = choice === "src" ? c.srcValue : c.dstValue;

    // Parse "<collection>:<key>" — collection determines how to write.
    const sep = c.conflictKey.indexOf(":");
    const collection = c.conflictKey.slice(0, sep);
    const key = c.conflictKey.slice(sep + 1);

    if (collection === "scalar") {
      (result as Record<string, unknown>)[key] = chosenValue;
      continue;
    }

    if (collection === "i18nKeys" || collection === "canvasLayout") {
      const map = (result[collection] ?? {}) as Record<string, unknown>;
      if (chosenValue === null) {
        delete map[key];
      } else {
        map[key] = chosenValue;
      }
      (result as Record<string, unknown>)[collection] = map;
      continue;
    }

    // Collection by id (menus, commands, dialogs, templates, dataSources)
    const list = ((result as Record<string, unknown>)[collection] ?? []) as Array<{ id: string }>;
    const idx = list.findIndex((x) => x.id === key);
    if (chosenValue === null) {
      // Delete
      if (idx !== -1) list.splice(idx, 1);
    } else {
      // Insert or replace
      if (idx === -1) list.push(chosenValue as { id: string });
      else list[idx] = chosenValue as { id: string };
    }
    (result as Record<string, unknown>)[collection] = list;
  }

  return result;
}
