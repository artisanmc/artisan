import { describe, expect, it } from "vitest";
import { parseShopYaml, serializeShopYaml } from "./shopYaml";
import type { BoutiqueState } from "./state";

const BUY_DSL = 'run_command "give {player} diamond_sword 1" as console';

const STATE: BoutiqueState = {
  wholeShopDiscount: 5,
  categories: [
    {
      id: "weapons",
      name: "Armes",
      icon: "DIAMOND_SWORD",
      discount: 10,
      items: [
        {
          id: "diamond_sword",
          name: "Épée",
          icon: "DIAMOND_SWORD",
          price: 100,
          discount: 5,
          lore: ["Tranchante"],
          actions: BUY_DSL,
        },
      ],
    },
  ],
};

describe("shopYaml", () => {
  it("round-trips state through boutique/v1 YAML with actions", () => {
    const yaml = serializeShopYaml(STATE);
    expect(yaml).toContain("schema: boutique/v1");
    expect(yaml).toContain("actions:");
    expect(yaml).not.toContain("buy_commands:");
    expect(parseShopYaml(yaml)).toEqual(STATE);
  });

  it("migrates legacy buy_commands into run_command steps ({player} literal)", () => {
    const yaml = [
      "schema: boutique/v1",
      "whole_shop_discount: 0",
      "categories:",
      "  - id: weapons",
      "    name: Armes",
      "    icon: DIAMOND_SWORD",
      "    discount: 0",
      "    items:",
      "      - id: sword",
      "        name: Épée",
      "        icon: DIAMOND_SWORD",
      "        price: 100",
      "        discount: 0",
      "        lore: []",
      '        buy_commands: ["give %player% diamond_sword 1", "broadcast %player% a acheté"]',
    ].join("\n");
    const state = parseShopYaml(yaml)!;
    expect(state.categories[0]!.items[0]!.actions).toEqual(
      [
        'run_command "give {player} diamond_sword 1" as console',
        'run_command "broadcast {player} a acheté" as console',
      ].join("\n"),
    );
  });

  it("parse returns null on wrong schema or invalid yaml", () => {
    expect(parseShopYaml("schema: nope/v9")).toBeNull();
    expect(parseShopYaml("{{{")).toBeNull();
  });
});
