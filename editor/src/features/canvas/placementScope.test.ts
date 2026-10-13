import type { Menu } from "@/domain/types";
import { describe, expect, it } from "vitest";
import { sourceIsContextFiltered } from "./placementScope";

function menuWith(inputs: unknown[]): Menu {
  return { id: "shop_category", contextInputs: inputs } as unknown as Menu;
}

/**
 * The real case behind this: a shop menu carries the placements of ALL its
 * categories, on the same slots, because only one category is live at a time.
 * Shown together, the other categories' forty placements covered the menu
 * with dashed slots — it looked like a reserved paginated area, in the middle
 * of placement mode.
 */
describe("sourceIsContextFiltered", () => {
  it("reconnaît une source filtrée par une entrée du menu", () => {
    const menu = menuWith([
      { kind: "primitive", name: "category", type: "string" },
      {
        kind: "sourceRef",
        name: "items",
        ref: "boutique:items",
        filter: { category: "{category}" },
      },
    ]);
    expect(sourceIsContextFiltered(menu, "items")).toBe(true);
  });

  /** Hard-coded filter: the source always renders the same thing, so a missing
   *  key is a real hole, and must show. */
  it("ne compte pas un filtre à valeur fixe", () => {
    const menu = menuWith([
      { kind: "sourceRef", name: "items", ref: "boutique:items", filter: { category: "cles" } },
    ]);
    expect(sourceIsContextFiltered(menu, "items")).toBe(false);
  });

  it("ne compte pas une source sans filtre", () => {
    const menu = menuWith([{ kind: "sourceRef", name: "items", ref: "pack:ds_items" }]);
    expect(sourceIsContextFiltered(menu, "items")).toBe(false);
  });

  it("suit la racine d'un chemin pointé", () => {
    const menu = menuWith([
      {
        kind: "sourceRef",
        name: "category",
        ref: "boutique:categories",
        params: { page: "{page}" },
      },
    ]);
    expect(sourceIsContextFiltered(menu, "category.items")).toBe(true);
  });

  it("une source inconnue du menu ne filtre rien", () => {
    expect(sourceIsContextFiltered(menuWith([]), "items")).toBe(false);
  });
});
