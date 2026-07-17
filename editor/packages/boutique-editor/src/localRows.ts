import { hasBoutiqueData, readBoutiqueState } from "./state";

/**
 * Authoring-time rows for the boutique data sources, computed from the
 * project's own moduleData — the canvas/library update live while the shop
 * form is edited, before any deploy. Row shapes (and the final_price formula)
 * MUST mirror the plugin's `BoutiqueModule.itemRow` / categories fetcher:
 * `final_price = round(max(0, price * (1 - (whole + category + item)/100)))`.
 * Returns null for foreign refs or projects without boutique data (the host
 * falls back to the live server snapshot).
 */
export function boutiqueLocalRows(
  project: unknown,
  ref: string,
): Record<string, unknown>[] | null {
  if (ref !== "boutique:categories" && ref !== "boutique:items") return null;
  if (!hasBoutiqueData(project)) return null;
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
