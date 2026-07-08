import { describe, expect, it } from "vitest";
import { parseShopYaml, serializeShopYaml } from "./shopYaml";
import type { BoutiqueState } from "./state";

const STATE: BoutiqueState = {
  wholeShopDiscount: 5,
  categories: [{
    id: "weapons", name: "Armes", icon: "DIAMOND_SWORD", discount: 10,
    items: [{
      id: "diamond_sword", name: "Épée", icon: "DIAMOND_SWORD", price: 100,
      discount: 5, lore: ["Tranchante"], buyCommands: ["give %player% diamond_sword 1"],
    }],
  }],
};

describe("shopYaml", () => {
  it("round-trips state through boutique/v1 YAML", () => {
    const yaml = serializeShopYaml(STATE);
    expect(yaml).toContain("schema: boutique/v1");
    expect(yaml).toContain("buy_commands:");
    expect(parseShopYaml(yaml)).toEqual(STATE);
  });

  it("parse returns null on wrong schema or invalid yaml", () => {
    expect(parseShopYaml("schema: nope/v9")).toBeNull();
    expect(parseShopYaml("{{{")).toBeNull();
  });
});
