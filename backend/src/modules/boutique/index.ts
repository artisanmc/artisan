import { and, eq, isNull } from "drizzle-orm";
import { stringify } from "yaml";
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
 * on edited projects); the backend mutates `editorJson` (single source of
 * truth), surgically regenerates the two affected bundle files, bumps the
 * optimistic-lock version (concurrent editors get the existing conflict
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
  buyCommands: string[];
}
interface BoutiqueCategory {
  id: string;
  name: string;
  icon: string;
  discount: number;
  items: BoutiqueItem[];
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
        lore: i.lore, buy_commands: i.buyCommands,
      })),
    })),
  });
}

export async function applyBoutiqueAdditem(
  serverKeyId: string,
  payload: BoutiqueAdditemPayload,
): Promise<BoutiqueAdditemResult> {
  if (!payload.item_id || !Number.isFinite(payload.price) || !payload.stack_yaml) {
    return { ok: false, error: "invalid_input" };
  }

  // The project that owns the boutique data on this server key.
  const rows = await db
    .select()
    .from(projects)
    .where(and(eq(projects.serverKeyId, serverKeyId), isNull(projects.deletedAt)));
  let target: (typeof rows)[number] | undefined;
  let editor: Record<string, unknown> | undefined;
  for (const row of rows) {
    if (!row.editorJson) continue;
    const parsed = (() => {
      try { return JSON.parse(row.editorJson) as Record<string, unknown>; } catch { return null; }
    })();
    const md = (parsed?.moduleData as Record<string, unknown> | undefined)?.boutique;
    if (parsed && md && typeof md === "object") {
      target = row;
      editor = parsed;
      break;
    }
  }
  if (!target || !editor) return { ok: false, error: "no_boutique_project" };

  // 1. Captured item (project entity behind the `item:<id>` icon ref).
  const ciId = `ci_${crypto.randomUUID().replaceAll("-", "").slice(0, 10)}`;
  const display: Record<string, unknown> = {};
  if (payload.display.material) display.material = payload.display.material;
  if (payload.display.head_texture) display.headTexture = payload.display.head_texture;
  if (payload.display.enchanted) display.enchanted = true;
  if (payload.display.count) display.count = payload.display.count;
  if (payload.display.name) display.name = payload.display.name;
  const capturedItems = Array.isArray(editor.capturedItems)
    ? (editor.capturedItems as Record<string, unknown>[])
    : [];
  capturedItems.push({
    id: ciId,
    name: payload.display.name ?? payload.item_id,
    stackYaml: payload.stack_yaml,
    display,
  });
  editor.capturedItems = capturedItems;

  // 2. Shop item, upserted by id in the target category.
  const moduleData = editor.moduleData as Record<string, unknown>;
  const boutique = moduleData.boutique as {
    wholeShopDiscount?: number;
    categories?: BoutiqueCategory[];
  };
  const categories: BoutiqueCategory[] = Array.isArray(boutique.categories)
    ? boutique.categories
    : [];
  boutique.categories = categories;
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
      buyCommands: [],
    });
  }

  // 3. Surgical bundle-file patch: only the two files this mutation affects.
  const files = (() => {
    try { return JSON.parse(target.filesJson) as Record<string, string>; } catch { return {}; }
  })();
  files["boutique/shop.yaml"] = serializeShopYaml({
    wholeShopDiscount: Number(boutique.wholeShopDiscount ?? 0),
    categories,
  });
  files[`items/${ciId}.yml`] = payload.stack_yaml;
  const hash = await computeBundleHash(files, target.id);

  // 4. Persist (version bump → concurrent editors hit the conflict guard) + commit.
  await upsertProjectContent(target.id, {
    hash,
    filesJson: JSON.stringify(files),
    editorJson: JSON.stringify(editor),
  });
  const branch = await getBranch(target.id, "main");
  let contentHash = hash;
  if (branch) {
    const commit = await createCommit({
      projectId: target.id,
      parentId: branch.headCommitId,
      files,
      editor,
      authorUserId: null,
      message: `additem ${payload.item_id} (/boutique additem)`,
    });
    await advanceBranchHead(target.id, "main", commit.id);
    contentHash = commit.contentHash;
  }
  return { ok: true, projectId: target.id, contentHash };
}
