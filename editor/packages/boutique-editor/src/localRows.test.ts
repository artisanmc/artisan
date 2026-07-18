import { describe, expect, it } from "vitest";
import { boutiqueLocalRows } from "./localRows";

const project = {
  moduleData: {
    boutique: {
      wholeShopDiscount: 10,
      categories: [
        {
          id: "weapons",
          name: "Armes",
          icon: "DIAMOND_SWORD",
          discount: 5,
          items: [
            {
              id: "diamond_sword",
              name: "Épée en diamant",
              icon: "DIAMOND_SWORD",
              price: 100,
              discount: 5,
              lore: ["Tranchante", "Rare"],
              actions: [],
            },
          ],
        },
        {
          id: "food",
          name: "Nourriture",
          icon: "BREAD",
          discount: 0,
          items: [],
        },
      ],
    },
  },
};

describe("boutiqueLocalRows", () => {
  it("mirrors the plugin's boutique:categories row shape", () => {
    expect(boutiqueLocalRows(project, "boutique:categories")).toEqual([
      { id: "weapons", name: "Armes", icon: "DIAMOND_SWORD" },
      { id: "food", name: "Nourriture", icon: "BREAD" },
    ]);
  });

  it("mirrors boutique:items incl. the finalPrice formula (whole+cat+item stacked)", () => {
    const rows = boutiqueLocalRows(project, "boutique:items")!;
    expect(rows).toHaveLength(1);
    // 100 * (1 - (10+5+5)/100) = 80 — same as ShopItem.finalPrice + itemRow round.
    expect(rows[0]).toEqual({
      id: "diamond_sword",
      name: "Épée en diamant",
      icon: "DIAMOND_SWORD",
      category: "weapons",
      price: 100,
      final_price: 80,
      lore: "Tranchante\nRare",
    });
  });

  it("returns null for foreign refs and for projects without boutique data", () => {
    expect(boutiqueLocalRows(project, "quests:all")).toBeNull();
    // No data → null so the host falls back to the live server snapshot.
    expect(boutiqueLocalRows({ moduleData: {} }, "boutique:items")).toBeNull();
    expect(boutiqueLocalRows({}, "boutique:categories")).toBeNull();
  });
});
