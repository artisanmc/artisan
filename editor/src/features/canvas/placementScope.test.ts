import type { Menu } from "@/domain/types";
import { describe, expect, it } from "vitest";
import { sourceIsContextFiltered } from "./placementScope";

function menuWith(inputs: unknown[]): Menu {
  return { id: "shop_category", contextInputs: inputs } as unknown as Menu;
}

/**
 * Le cas réel qui a motivé ça : un menu de boutique porte les placements de
 * TOUTES ses catégories, sur les mêmes slots, parce qu'une seule catégorie est
 * vivante à la fois. Affichés ensemble, les quarante placements des autres
 * catégories couvraient le menu de cases pointillées — on croyait voir un
 * territoire réservé de mode paginé, en plein mode placement.
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

  /** Filtre en dur : la source rend toujours la même chose, donc une clé
   *  introuvable est bien un trou, et doit se voir. */
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
