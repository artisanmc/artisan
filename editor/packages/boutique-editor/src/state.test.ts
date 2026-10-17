import { describe, expect, it } from "vitest";
import { parseShopYaml, serializeShopYaml } from "./shopYaml";
import type { BoutiqueState } from "./state";
import { exportBoutiqueFiles, readBoutiqueState } from "./state";

const VALID_SHOP = `schema: boutique/v1
whole_shop_discount: 5
categories:
  - id: weapons
    name: Armes
    icon: DIAMOND_SWORD
    discount: 0
    items: []
`;

const BROKEN_SHOP = "schema: boutique/v1\ncategories: [unterminated";

function projectWithFiles(files: Record<string, string>): unknown {
  return { moduleData: { boutique: { __files: files } } };
}

describe("readBoutiqueState — __files carriage", () => {
  it("carries unknown __files entries as extraFiles", () => {
    const state = readBoutiqueState(
      projectWithFiles({ "shop.yaml": VALID_SHOP, "notes/readme.txt": "hi", "promo.yaml": "x: 1" }),
    );
    expect(state.categories[0]?.id).toBe("weapons");
    expect(state.extraFiles).toEqual({ "notes/readme.txt": "hi", "promo.yaml": "x: 1" });
    expect(state.parseFailed).toBeUndefined();
  });

  it("unparseable shop.yaml → keeps raw bytes + parseFailed, still carries extras", () => {
    const state = readBoutiqueState(
      projectWithFiles({ "shop.yaml": BROKEN_SHOP, "promo.yaml": "x: 1" }),
    );
    expect(state.parseFailed).toBe(true);
    expect(state.rawShopYaml).toBe(BROKEN_SHOP);
    expect(state.categories).toEqual([]);
    expect(state.extraFiles).toEqual({ "promo.yaml": "x: 1" });
  });
});

describe("exportBoutiqueFiles", () => {
  it("__files extra entries are preserved through read→export", () => {
    const project = projectWithFiles({ "shop.yaml": VALID_SHOP, "notes/readme.txt": "hi" });
    const files = exportBoutiqueFiles(project);
    expect(files["boutique/notes/readme.txt"]).toBe("hi");
    const roundTripped = parseShopYaml(files["boutique/shop.yaml"]!);
    expect(roundTripped?.wholeShopDiscount).toBe(5);
    expect(roundTripped?.categories[0]?.id).toBe("weapons");
  });

  it("unparseable shop.yaml → export re-emits the raw bytes, not an empty catalog", () => {
    const files = exportBoutiqueFiles(projectWithFiles({ "shop.yaml": BROKEN_SHOP }));
    expect(files["boutique/shop.yaml"]).toBe(BROKEN_SHOP);
  });

  it("normal structured state unaffected (serializes the catalog)", () => {
    const state: BoutiqueState = {
      wholeShopDiscount: 2,
      categories: [{ id: "misc", name: "Divers", icon: "CHEST", discount: 0, items: [] }],
    };
    const files = exportBoutiqueFiles({ moduleData: { boutique: state } });
    expect(files["boutique/shop.yaml"]).toBe(serializeShopYaml(state));
    expect(Object.keys(files)).toEqual(["boutique/shop.yaml"]);
  });

  it("explicit-edit shape (extraFiles kept, parseFailed cleared) exports structured yaml + extras", () => {
    const state: BoutiqueState = {
      wholeShopDiscount: 0,
      categories: [],
      extraFiles: { "promo.yaml": "x: 1" },
    };
    const files = exportBoutiqueFiles({ moduleData: { boutique: state } });
    expect(files["boutique/promo.yaml"]).toBe("x: 1");
    expect(parseShopYaml(files["boutique/shop.yaml"]!)).toEqual({
      wholeShopDiscount: 0,
      categories: [],
    });
  });
});
