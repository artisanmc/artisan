import { describe, expect, it } from "vitest";

import type { PreviewCallContext } from "./previewCallContexts";
import { currentCallIndex, effectivePreviewArgs, nextCallContext } from "./previewCallNavigation";

/**
 * Moving from one context to another is the editing gesture of a
 * parameterised menu: one document serves N screens, and placement is only
 * readable through one of them (ADR `parameterised-menu-over-menu-per-category`).
 * These two functions are the logic behind the clickable edge and the canvas
 * banner.
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

  /** Matching one argument out of two is not enough: it would show a hybrid
   *  screen that matches no real call. */
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

  /** Clicking the shop_main → shop_category edge must only offer screens
   *  reachable FROM shop_main: that is what cycles through categories without
   *  ever jumping to a call coming from elsewhere. */
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
 * The banner said "pick a context" above a menu already rendered in a
 * specific context: it only read the explicit arguments, while an input with
 * a `default` applies on its own. It described a state nobody saw.
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

  /** An empty default is not a context: it must not pretend to be one. */
  it("ignore un défaut vide", () => {
    expect(effectivePreviewArgs(menu, undefined)).not.toHaveProperty("category_name");
  });
});
