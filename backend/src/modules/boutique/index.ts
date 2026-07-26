import { and, eq, isNull } from "drizzle-orm";
import { parse, stringify } from "yaml";
import { db } from "../../db/index";
import { projects } from "../../db/schema";
import { advanceBranchHead, getBranch } from "../../lib/branchStorage";
import { createCommit } from "../../lib/commitStorage";
import { computeBundleHash } from "../../lib/hashUtils";
import { upsertProjectContent } from "../../lib/projectStorage";

/**
 * Backend boutique module — applies the `/boutique additem` in-game mutation to
 * the project that owns the shop data (ADR `captured-items-and-module-field-kit`
 * §3): the plugin NEVER writes project files itself (the FTP/local_push hazard
 * on edited projects); the backend patches the project's FILE TREE (files-first:
 * the tree is the single source of truth — `boutique/shop.yaml`, the captured
 * item's `items/<id>.yml`, and the `.artisan/editor.yaml` item metadata), bumps
 * the optimistic-lock version (concurrent editors get the existing conflict
 * banner), and commits. The caller (hub) broadcasts `bundle_available`.
 */

export interface BoutiqueAdditemPayload {
  item_id: string;
  price: number;
  category?: string;
  stack_yaml: string;
  display: {
    material?: string;
    head_texture?: string;
    enchanted?: boolean;
    count?: number;
    name?: string;
  };
}

export type BoutiqueAdditemResult =
  | { ok: true; projectId: string; contentHash: string }
  | { ok: false; error: "no_boutique_project" | "invalid_input" };

interface BoutiqueItem {
  id: string;
  name: string;
  icon: string;
  price: number;
  discount: number;
  lore: string[];
  /** Purchase step tree (wire shape, literal text). */
  actions?: unknown[];
  /** Legacy field — migrated to run_command steps on serialize. */
  buy_commands?: string[];
}
interface BoutiqueCategory {
  id: string;
  name: string;
  icon: string;
  discount: number;
  items: BoutiqueItem[];
}

/** Mirror of the editor's migrateBuyCommands (boutique-editor/src/shopYaml.ts). */
function itemActions(i: BoutiqueItem): unknown[] {
  if (Array.isArray(i.actions)) return i.actions;
  return (i.buy_commands ?? []).map((cmd) => ({
    kind: "action",
    action: { type: "run_command", command: String(cmd).replace(/%player%/g, "{player}"), as: "console" },
  }));
}

/** Mirror of the editor's serializeShopYaml (boutique-editor/src/shopYaml.ts) —
 *  duplicated here because the backend container doesn't mount editor/. */
function serializeShopYaml(state: {
  wholeShopDiscount: number;
  categories: BoutiqueCategory[];
}): string {
  return stringify({
    schema: "boutique/v1",
    whole_shop_discount: state.wholeShopDiscount,
    categories: state.categories.map((c) => ({
      id: c.id, name: c.name, icon: c.icon, discount: c.discount,
      items: c.items.map((i) => ({
        id: i.id, name: i.name, icon: i.icon, price: i.price, discount: i.discount,
        lore: i.lore, actions: itemActions(i),
      })),
    })),
  });
}

/** Parse `boutique/shop.yaml` (boutique/v1 wire) into the mutable state. */
function parseShopYaml(raw: string | undefined): {
  wholeShopDiscount: number;
  categories: BoutiqueCategory[];
} {
  const empty = { wholeShopDiscount: 0, categories: [] as BoutiqueCategory[] };
  if (!raw) return empty;
  try {
    const y = parse(raw) as {
      whole_shop_discount?: unknown;
      categories?: BoutiqueCategory[];
    } | null;
    if (!y || typeof y !== "object") return empty;
    return {
      wholeShopDiscount: Number(y.whole_shop_discount ?? 0),
      categories: Array.isArray(y.categories)
        ? y.categories.map((c) => ({ ...c, items: Array.isArray(c.items) ? c.items : [] }))
        : [],
    };
  } catch {
    return empty;
  }
}

/** Captured-item files + `.artisan/editor.yaml` items metadata (shared by both formats). */
function writeCapturedItem(
  files: Record<string, string>,
  base: string,
  payload: BoutiqueAdditemPayload,
): string {
  const ciId = `ci_${crypto.randomUUID().replaceAll("-", "").slice(0, 10)}`;
  const display: Record<string, unknown> = {};
  if (payload.display.material) display.material = payload.display.material;
  if (payload.display.head_texture) display.headTexture = payload.display.head_texture;
  if (payload.display.enchanted) display.enchanted = true;
  if (payload.display.count) display.count = payload.display.count;
  if (payload.display.name) display.name = payload.display.name;
  files[`${base}/items/${ciId}.yml`] = payload.stack_yaml;
  const editorStatePath = `${base}/.artisan/editor.yaml`;
  const editorState = (() => {
    try { return (parse(files[editorStatePath] ?? "") as Record<string, unknown>) ?? {}; }
    catch { return {} as Record<string, unknown>; }
  })();
  if (typeof editorState.schema !== "string") editorState.schema = "editor-state/v1";
  const itemsMeta = (editorState.items ??= {}) as Record<string, unknown>;
  itemsMeta[ciId] = { name: payload.display.name ?? payload.item_id, display };
  files[editorStatePath] = stringify(editorState, { lineWidth: 0 });
  return ciId;
}

/** Persist the mutated tree + commit on main (shared by both formats). */
async function persistAndCommit(
  target: { id: string },
  files: Record<string, string>,
  itemId: string,
): Promise<BoutiqueAdditemResult> {
  const hash = await computeBundleHash(files, target.id);
  await upsertProjectContent(target.id, { hash, filesJson: JSON.stringify(files) });
  const branch = await getBranch(target.id, "main");
  let contentHash = hash;
  if (branch) {
    const commit = await createCommit({
      projectId: target.id,
      parentId: branch.headCommitId,
      files,
      authorUserId: null,
      message: `additem ${itemId} (/boutique additem)`,
    });
    await advanceBranchHead(target.id, "main", commit.id);
    contentHash = commit.contentHash;
  }
  return { ok: true, projectId: target.id, contentHash };
}

/**
 * Upsert into the declared-model Table (ADR composable-data-models §8, BARE
 * form per ADR bare-data-files ④): `data/categories/<cat>.yaml` rows carry the
 * default language's LITERAL text for name — no key minting, lang/ untouched.
 * Rows written by the pre-bare migrator may still carry keys: category
 * matching resolves them through lang/ (tolerance), and an update on such an
 * item rewrites the key's translation in place.
 */
async function applyToDeclaredTable(
  target: { id: string },
  files: Record<string, string>,
  base: string,
  payload: BoutiqueAdditemPayload,
): Promise<BoutiqueAdditemResult> {
  const ciId = writeCapturedItem(files, base, payload);

  const metaPath = `${base}/data/categories/_source.yaml`;
  const meta = (() => {
    try { return (parse(files[metaPath] ?? "") as Record<string, unknown>) ?? {}; }
    catch { return {} as Record<string, unknown>; }
  })();
  const order: string[] = Array.isArray(meta.order) ? meta.order.map(String) : [];

  // Default lang + its translation map (for name-based category matching and
  // for minting the new item's name literal).
  const manifest = (() => {
    try { return (parse(files[`${base}/manifest.yaml`] ?? "") as Record<string, unknown>) ?? {}; }
    catch { return {} as Record<string, unknown>; }
  })();
  const lang = typeof manifest.default_lang === "string" && manifest.default_lang ? manifest.default_lang : "fr";
  const langPath = `${base}/lang/${lang}.yaml`;
  const translations = (() => {
    try { return (parse(files[langPath] ?? "") as Record<string, unknown>) ?? {}; }
    catch { return {} as Record<string, unknown>; }
  })();
  let langDirty = false;

  // Find the target category row file: by id, else by resolved name.
  const wanted = payload.category?.trim().toLowerCase();
  let rowKey: string | undefined;
  let row: Record<string, unknown> | undefined;
  for (const key of order) {
    const parsed = (() => {
      try { return (parse(files[`${base}/data/categories/${key}.yaml`] ?? "") as Record<string, unknown>) ?? null; }
      catch { return null; }
    })();
    if (!parsed) continue;
    // Bare form: name IS the literal; legacy rows carry a key — resolve it.
    const rawName = String(parsed.name ?? "");
    const resolvedName = String(translations[rawName] ?? rawName).toLowerCase();
    if (!wanted || String(parsed.id).toLowerCase() === wanted || resolvedName === wanted) {
      rowKey = key;
      row = parsed;
      break;
    }
  }
  if (!row || !rowKey) {
    // New category (or empty table): the name is the literal text.
    rowKey = (wanted || "divers").replace(/[^a-z0-9_-]+/g, "_");
    row = { id: rowKey, name: payload.category?.trim() || "Divers", icon: "CHEST", discount: 0, items: [] };
    if (!order.includes(rowKey)) order.push(rowKey);
    meta.order = order;
    files[metaPath] = stringify(meta, { lineWidth: 0 });
  }

  const items: Record<string, unknown>[] = Array.isArray(row.items)
    ? (row.items as Record<string, unknown>[])
    : [];
  row.items = items;
  const existing = items.find((i) => i.id === payload.item_id);
  if (existing) {
    if (payload.display.name) {
      // Legacy row whose name is a lang KEY: update the translation in place;
      // bare row: overwrite the literal.
      if (typeof existing.name === "string" && translations[existing.name] !== undefined) {
        translations[existing.name] = payload.display.name;
        langDirty = true;
      } else {
        existing.name = payload.display.name;
      }
    }
    existing.icon = `item:${ciId}`;
    existing.price = payload.price;
  } else {
    items.push({
      id: payload.item_id,
      name: payload.display.name ?? payload.item_id,
      icon: `item:${ciId}`,
      price: payload.price,
      discount: 0,
      lore: [],
      actions: "",
    });
  }
  files[`${base}/data/categories/${rowKey}.yaml`] = stringify(row, { lineWidth: 0 });
  if (langDirty) files[langPath] = stringify(translations, { lineWidth: 0 });

  return persistAndCommit(target, files, payload.item_id);
}

export async function applyBoutiqueAdditem(
  serverKeyId: string,
  payload: BoutiqueAdditemPayload,
): Promise<BoutiqueAdditemResult> {
  if (!payload.item_id || !Number.isFinite(payload.price) || !payload.stack_yaml) {
    return { ok: false, error: "invalid_input" };
  }

  // The project that owns the boutique data on this server key — files-first:
  // recognized by the declared-model Table (data/categories/, the migrated /
  // bootstrapped format, ADR composable-data-models §8) or the legacy
  // boutique/shop.yaml during the transition.
  const rows = await db
    .select()
    .from(projects)
    .where(and(eq(projects.serverKeyId, serverKeyId), isNull(projects.deletedAt)));
  let target: (typeof rows)[number] | undefined;
  let files: Record<string, string> = {};
  let declaredTable = false;
  for (const row of rows) {
    const parsed = (() => {
      try { return JSON.parse(row.filesJson) as Record<string, string>; } catch { return null; }
    })();
    if (!parsed) continue;
    const p = `plugins/Artisan/projects/${row.id}`;
    if (`${p}/data/categories/_source.yaml` in parsed) {
      target = row;
      files = parsed;
      declaredTable = true;
      break;
    }
    if (`${p}/boutique/shop.yaml` in parsed) {
      target = row;
      files = parsed;
      break;
    }
  }
  if (!target) return { ok: false, error: "no_boutique_project" };
  const base = `plugins/Artisan/projects/${target.id}`;
  if (declaredTable) {
    return applyToDeclaredTable(target, files, base, payload);
  }

  // 1. Captured item (project entity behind the `item:<id>` icon ref).
  const ciId = writeCapturedItem(files, base, payload);

  // 2. Shop item, upserted by id in the target category.
  const shop = parseShopYaml(files[`${base}/boutique/shop.yaml`]);
  const categories = shop.categories;
  const wanted = payload.category?.trim().toLowerCase();
  let cat = wanted
    ? categories.find((c) => c.id.toLowerCase() === wanted || c.name.toLowerCase() === wanted)
    : categories[0];
  if (!cat) {
    cat = { id: wanted || "divers", name: payload.category?.trim() || "Divers", icon: "CHEST", discount: 0, items: [] };
    categories.push(cat);
  }
  const existing = cat.items.find((i) => i.id === payload.item_id);
  if (existing) {
    existing.name = payload.display.name ?? existing.name;
    existing.icon = `item:${ciId}`;
    existing.price = payload.price;
  } else {
    cat.items.push({
      id: payload.item_id,
      name: payload.display.name ?? payload.item_id,
      icon: `item:${ciId}`,
      price: payload.price,
      discount: 0,
      lore: [],
      actions: [],
    });
  }
  files[`${base}/boutique/shop.yaml`] = serializeShopYaml(shop);

  // 3. Persist (version bump → concurrent editors hit the conflict guard) + commit.
  return persistAndCommit(target, files, payload.item_id);
}
