import { describe, expect, it } from "vitest";

import type { PreviewCallContext } from "./previewCallContexts";
import { currentCallIndex, effectivePreviewArgs, nextCallContext } from "./previewCallNavigation";

/**
 * Naviguer d'un contexte à l'autre est le geste d'édition d'un menu paramétré :
 * un seul document sert N écrans, et le placement n'est lisible qu'à travers
 * l'un d'eux (ADR `parameterised-menu-over-menu-per-category`). Ces deux
 * fonctions sont la logique derrière l'arête cliquable et le bandeau du canvas.
 */
const CTX: PreviewCallContext[] = [
  {
    from: "shop_main",
    label: "Les Clés",
    args: { category: "les_cles", category_name: "Les Clés" },
  },
  {
    from: "shop_main",
    label: "Les Kits",
    args: { category: "les_kits", category_name: "Les Kits" },
  },
  { from: "promo", label: "Promo", args: { category: "les_packs", category_name: "Les Packs" } },
];

describe("currentCallIndex", () => {
  it("reconnaît le contexte dont TOUS les arguments correspondent", () => {
    expect(currentCallIndex(CTX, { category: "les_kits", category_name: "Les Kits" })).toBe(1);
  });

  it("rend -1 quand aucun contexte n'est posé", () => {
    expect(currentCallIndex(CTX, {})).toBe(-1);
  });

  /** Un seul argument sur deux ne suffit pas : on regarderait un écran hybride
   *  qui ne correspond à aucun appel réel. */
  it("rend -1 sur une correspondance partielle", () => {
    expect(currentCallIndex(CTX, { category: "les_kits" })).toBe(-1);
  });
});

describe("nextCallContext", () => {
  it("part du premier contexte quand aucun n'est posé", () => {
    expect(nextCallContext(CTX, {})?.label).toBe("Les Clés");
  });

  it("avance d'un cran, et boucle à la fin", () => {
    expect(nextCallContext(CTX, CTX[0]!.args)?.label).toBe("Les Kits");
    expect(nextCallContext(CTX, CTX[2]!.args)?.label).toBe("Les Clés");
  });

  /** Cliquer l'arête shop_main → shop_category ne doit proposer que les écrans
   *  atteignables DEPUIS shop_main : c'est ce qui fait défiler les catégories
   *  sans jamais sauter sur un appel venu d'ailleurs. */
  it("se restreint aux contextes d'un appelant donné", () => {
    expect(nextCallContext(CTX, CTX[1]!.args, "shop_main")?.label).toBe("Les Clés");
    expect(nextCallContext(CTX, {}, "promo")?.label).toBe("Promo");
  });

  it("rend null quand l'appelant n'ouvre aucun contexte", () => {
    expect(nextCallContext(CTX, {}, "inconnu")).toBeNull();
  });

  it("rend null sans contexte du tout", () => {
    expect(nextCallContext([], {})).toBeNull();
  });
});

/**
 * Le bandeau annonçait « choisis un contexte » au-dessus d'un menu déjà rendu
 * dans un contexte précis : il ne lisait que les arguments explicites, alors
 * qu'un input avec un `default` s'applique de lui-même. Il décrivait un état
 * que personne ne voyait.
 */
describe("effectivePreviewArgs", () => {
  const menu = {
    id: "shop_category",
    contextInputs: [
      { kind: "primitive", name: "category", type: "string", default: "les_cles" },
      { kind: "primitive", name: "category_name", type: "string", default: "" },
      { kind: "sourceRef", name: "items", ref: "boutique:items" },
    ],
  } as never;

  it("applique le défaut d'un input quand rien n'a été choisi", () => {
    expect(effectivePreviewArgs(menu, undefined)).toEqual({ category: "les_cles" });
  });

  it("un choix explicite l'emporte sur le défaut", () => {
    expect(effectivePreviewArgs(menu, { category: "kits" })).toEqual({ category: "kits" });
  });

  /** Un défaut vide n'est pas un contexte : il ne doit pas prétendre en être un. */
  it("ignore un défaut vide", () => {
    expect(effectivePreviewArgs(menu, undefined)).not.toHaveProperty("category_name");
  });
});
