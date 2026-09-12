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
              actions: "",
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
      price_display: "&m100 &f80 tokens (-20%)",
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

// Since bare-data-files the catalogue is a Project source, not moduleData.
// Reading only moduleData left `boutique:items` unresolvable offline, so a
// category menu drew dashed slots instead of its items (2026-08-12).
describe("rows derived from the project's files", () => {
  const project = {
    dataSources: [
      {
        id: "categories",
        shape: "table",
        rows: [
          {
            id: "les_cles",
            name: "Les Clés",
            icon: "item:ci_les_cles",
            discount: 10,
            items: [
              {
                id: "cle",
                name: "Clé",
                icon: "item:ci_cle",
                price: 500,
                discount: 0,
                lore: ["a", "b"],
              },
            ],
          },
        ],
      },
      { id: "shop_settings", shape: "config", value: { whole_shop_discount: 20 } },
    ],
  };

  it("derives categories", () => {
    expect(boutiqueLocalRows(project, "boutique:categories")).toMatchObject([
      { id: "les_cles", name: "Les Clés", icon: "item:ci_les_cles", discount: 10 },
    ]);
    expect(boutiqueLocalRows(project, "boutique:categories")![0]!.items).toEqual(
      boutiqueLocalRows(project, "boutique:items"),
    );
  });

  it("flattens items and prices them like the plugin", () => {
    const rows = boutiqueLocalRows(project, "boutique:items")!;
    expect(rows).toHaveLength(1);
    // 500 * (1 - (20 whole + 10 category + 0 item)/100) = 350
    expect(rows[0]).toMatchObject({
      id: "cle",
      category: "les_cles",
      price: 500,
      final_price: 350,
      lore: "a\nb",
    });
  });

  it("returns null for a project with no catalogue at all", () => {
    expect(boutiqueLocalRows({ dataSources: [] }, "boutique:items")).toBeNull();
  });

  it("uses the configured discount price format", () => {
    const configured = structuredClone(project);
    configured.dataSources[1]!.value = {
      whole_shop_discount: 20,
      placeholders: {
        discount_price_display: "%old_price% → %price% jetons (-%discount_percent%%)",
      },
    } as (typeof configured.dataSources)[1]["value"];
    expect(boutiqueLocalRows(configured, "boutique:items")![0]!.price_display).toBe(
      "500 → 350 jetons (-30%)",
    );
  });
});
