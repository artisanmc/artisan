import { hasBoutiqueData, readBoutiqueState } from "./state";

/** Row of the project's `categories` table source (ADR bare-data-files). */
interface CategoryRow {
  id?: unknown;
  name?: unknown;
  icon?: unknown;
  discount?: unknown;
  items?: unknown;
}

interface ProjectSources {
  dataSources?: {
    id?: unknown;
    shape?: unknown;
    rows?: unknown;
    value?: unknown;
  }[];
}

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

function source(project: unknown, id: string) {
  return (project as ProjectSources).dataSources?.find((d) => String(d.id) === id);
}

/**
 * Read the catalogue from the project's own files.
 *
 * Since the bare-data-files ADR the catalogue IS a Project source (`categories`,
 * a declared Table whose rows nest their items) — `moduleData.boutique` is dead
 * storage. Deriving the preview rows here is what the plugin's fetcher does at
 * runtime over the same files, so the canvas matches the server offline.
 */
function rowsFromProjectFiles(
  project: unknown,
  ref: string,
): Record<string, unknown>[] | null {
  const cats = source(project, "categories");
  if (!cats || cats.shape !== "table" || !Array.isArray(cats.rows)) return null;
  const categories = cats.rows as CategoryRow[];

  if (ref === "boutique:categories") {
    return categories.map((c) => ({
      id: str(c.id),
      name: c.name,
      icon: c.icon,
      discount: num(c.discount),
    }));
  }

  const settings = source(project, "shop_settings");
  const whole = num((settings?.value as { whole_shop_discount?: unknown } | undefined)?.whole_shop_discount);

  return categories.flatMap((c) => {
    const items = Array.isArray(c.items) ? (c.items as Record<string, unknown>[]) : [];
    return items.map((i) => {
      const price = num(i.price);
      return {
        id: str(i.id),
        name: i.name,
        icon: i.icon,
        category: str(c.id),
        price,
        // Mirrors the plugin's BoutiqueModule.itemRow — the canvas must price
        // an item exactly like the server does.
        final_price: Math.round(
          Math.max(0, price * (1 - (whole + num(c.discount) + num(i.discount)) / 100)),
        ),
        lore: Array.isArray(i.lore) ? (i.lore as unknown[]).join("\n") : (i.lore ?? ""),
      };
    });
  });
}

/**
 * Authoring-time rows for the boutique data sources, so the canvas and the
 * library render the real catalogue before any deploy — and, since they come
 * from the project's files, without a live server.
 *
 * Row shapes (and the final_price formula) MUST mirror the plugin's
 * `BoutiqueModule.itemRow` / categories fetcher. Returns null for foreign refs
 * or a project holding no catalogue (the host then falls back to the live
 * server snapshot).
 */
export function boutiqueLocalRows(
  project: unknown,
  ref: string,
): Record<string, unknown>[] | null {
  if (ref !== "boutique:categories" && ref !== "boutique:items") return null;

  // Legacy authoring state (pre bare-data-files) still wins while it exists:
  // it is what the old shop form edits live.
  if (hasBoutiqueData(project)) {
    const state = readBoutiqueState(project);
    if (ref === "boutique:categories") {
      return state.categories.map((c) => ({ id: c.id, name: c.name, icon: c.icon }));
    }
    return state.categories.flatMap((c) =>
      c.items.map((i) => ({
        id: i.id,
        name: i.name,
        icon: i.icon,
        category: c.id,
        price: i.price,
        final_price: Math.round(
          Math.max(0, i.price * (1 - (state.wholeShopDiscount + c.discount + i.discount) / 100)),
        ),
        lore: i.lore.join("\n"),
      })),
    );
  }

  return rowsFromProjectFiles(project, ref);
}
