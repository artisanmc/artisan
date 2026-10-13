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
  it("recognizes the context whose arguments ALL match", () => {
    expect(currentCallIndex(CTX, { category: "les_kits", category_name: "Les Kits" })).toBe(1);
  });

  it("returns -1 when no context is set", () => {
    expect(currentCallIndex(CTX, {})).toBe(-1);
  });

  /** Matching one argument out of two is not enough: it would show a hybrid
   *  screen that matches no real call. */
  it("returns -1 on a partial match", () => {
    expect(currentCallIndex(CTX, { category: "les_kits" })).toBe(-1);
  });
});

describe("nextCallContext", () => {
  it("starts from the first context when none is set", () => {
    expect(nextCallContext(CTX, {})?.label).toBe("Les Clés");
  });

  it("advances one step, and wraps around at the end", () => {
    expect(nextCallContext(CTX, CTX[0]!.args)?.label).toBe("Les Kits");
    expect(nextCallContext(CTX, CTX[2]!.args)?.label).toBe("Les Clés");
  });

  /** Clicking the shop_main → shop_category edge must only offer screens
   *  reachable FROM shop_main: that is what cycles through categories without
   *  ever jumping to a call coming from elsewhere. */
  it("narrows to the contexts of a given caller", () => {
    expect(nextCallContext(CTX, CTX[1]!.args, "shop_main")?.label).toBe("Les Clés");
    expect(nextCallContext(CTX, {}, "promo")?.label).toBe("Promo");
  });

  it("returns null when the caller opens no context", () => {
    expect(nextCallContext(CTX, {}, "inconnu")).toBeNull();
  });

  it("returns null with no context at all", () => {
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

  it("applies an input's default when nothing has been chosen", () => {
    expect(effectivePreviewArgs(menu, undefined)).toEqual({ category: "les_cles" });
  });

  it("an explicit choice wins over the default", () => {
    expect(effectivePreviewArgs(menu, { category: "kits" })).toEqual({ category: "kits" });
  });

  /** An empty default is not a context: it must not pretend to be one. */
  it("ignores an empty default", () => {
    expect(effectivePreviewArgs(menu, undefined)).not.toHaveProperty("category_name");
  });
});
