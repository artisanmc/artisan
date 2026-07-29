import { describe, expect, it } from "vitest";
import {
  ENCHANTMENTS,
  HIDE_FLAGS,
  clampEnchantLevel,
  enchantMaxLevel,
  formatEnchant,
  isColorable,
  normalizeEnchantId,
  parseEnchants,
  parseHideFlags,
  readAdvanced,
  serializeEnchants,
  writeAdvanced,
} from "./itemAdvanced";

describe("normalizeEnchantId", () => {
  it("strips the minecraft namespace and lowercases", () => {
    expect(normalizeEnchantId("minecraft:Sharpness")).toBe("sharpness");
    expect(normalizeEnchantId("SHARPNESS")).toBe("sharpness");
  });

  it("maps legacy Bukkit constant names to modern ids", () => {
    expect(normalizeEnchantId("DAMAGE_ALL")).toBe("sharpness");
    expect(normalizeEnchantId("PROTECTION_ENVIRONMENTAL")).toBe("protection");
    expect(normalizeEnchantId("LOOT_BONUS_BLOCKS")).toBe("fortune");
    expect(normalizeEnchantId("ARROW_INFINITE")).toBe("infinity");
  });

  it("passes unknown (modded) ids through untouched apart from casing", () => {
    expect(normalizeEnchantId("mymod:Soulbound")).toBe("mymod:soulbound");
  });
});

describe("parseEnchants", () => {
  it("reads the canonical map form", () => {
    expect(parseEnchants({ sharpness: 5, unbreaking: 3 })).toEqual([
      { id: "sharpness", level: 5 },
      { id: "unbreaking", level: 3 },
    ]);
  });

  it("reads the list-of-objects form", () => {
    expect(
      parseEnchants([
        { id: "minecraft:mending", level: 1 },
        { id: "DAMAGE_ALL", level: 2 },
      ]),
    ).toEqual([
      { id: "mending", level: 1 },
      { id: "sharpness", level: 2 },
    ]);
  });

  it("defaults a missing or unparseable level to 1", () => {
    expect(parseEnchants({ mending: null })).toEqual([{ id: "mending", level: 1 }]);
    expect(parseEnchants([{ id: "lure" }])).toEqual([{ id: "lure", level: 1 }]);
  });

  it("reads string levels (YAML quirk)", () => {
    expect(parseEnchants({ sharpness: "4" })).toEqual([{ id: "sharpness", level: 4 }]);
  });

  it("drops entries with no usable id, and returns undefined when empty", () => {
    expect(parseEnchants([{ level: 3 }])).toBeUndefined();
    expect(parseEnchants({})).toBeUndefined();
    expect(parseEnchants(undefined)).toBeUndefined();
    expect(parseEnchants("sharpness")).toBeUndefined();
  });
});

describe("serializeEnchants", () => {
  it("writes the canonical map form with short ids", () => {
    expect(
      serializeEnchants([
        { id: "sharpness", level: 5 },
        { id: "unbreaking", level: 3 },
      ]),
    ).toEqual({ sharpness: 5, unbreaking: 3 });
  });

  it("round-trips through parse", () => {
    const list = [
      { id: "sharpness", level: 5 },
      { id: "mending", level: 1 },
    ];
    expect(parseEnchants(serializeEnchants(list))).toEqual(list);
  });
});

describe("enchant levels", () => {
  it("knows vanilla max levels", () => {
    expect(enchantMaxLevel("sharpness")).toBe(5);
    expect(enchantMaxLevel("mending")).toBe(1);
  });

  it("has no ceiling for unknown/modded ids", () => {
    expect(enchantMaxLevel("mymod:soulbound")).toBeUndefined();
    expect(clampEnchantLevel("mymod:soulbound", 120)).toBe(120);
  });

  it("clamps to at least 1 but allows going past the vanilla max", () => {
    // Over-max is legal in Minecraft (commands do it) — the UI only warns.
    expect(clampEnchantLevel("sharpness", 10)).toBe(10);
    expect(clampEnchantLevel("sharpness", 0)).toBe(1);
    expect(clampEnchantLevel("sharpness", -3)).toBe(1);
  });

  it("catalogues the vanilla enchantments", () => {
    const ids = ENCHANTMENTS.map((e) => e.id);
    expect(ids).toContain("sharpness");
    expect(ids).toContain("wind_burst");
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("formatEnchant", () => {
  it("renders the vanilla tooltip spelling", () => {
    expect(formatEnchant({ id: "sharpness", level: 5 })).toBe("Sharpness V");
    expect(formatEnchant({ id: "bane_of_arthropods", level: 2 })).toBe("Bane Of Arthropods II");
  });

  it("omits the numeral for single-level enchantments, as in game", () => {
    expect(formatEnchant({ id: "mending", level: 1 })).toBe("Mending");
    // Multi-level enchantments keep their I.
    expect(formatEnchant({ id: "sharpness", level: 1 })).toBe("Sharpness I");
  });

  it("falls back to digits past X", () => {
    expect(formatEnchant({ id: "sharpness", level: 42 })).toBe("Sharpness 42");
  });

  it("drops the namespace of a modded id", () => {
    expect(formatEnchant({ id: "mymod:soulbound", level: 1 })).toBe("Soulbound I");
  });
});

describe("parseHideFlags", () => {
  it("normalizes short, Bukkit and namespaced spellings", () => {
    expect(parseHideFlags(["attributes", "HIDE_ENCHANTS", "Additional"])).toEqual([
      "attributes",
      "enchants",
      "additional",
    ]);
  });

  it("drops unknown flags and dedupes", () => {
    expect(parseHideFlags(["enchants", "enchants", "nope"])).toEqual(["enchants"]);
    expect(parseHideFlags([])).toBeUndefined();
    expect(parseHideFlags("enchants")).toBeUndefined();
  });

  it("exposes the flag catalogue", () => {
    expect(HIDE_FLAGS).toContain("unbreakable");
  });
});

describe("isColorable", () => {
  it("accepts leather armor, potions, tipped arrows and firework stars", () => {
    expect(isColorable("leather_chestplate")).toBe(true);
    expect(isColorable("LEATHER_HORSE_ARMOR")).toBe(true);
    expect(isColorable("minecraft:splash_potion")).toBe(true);
    expect(isColorable("tipped_arrow")).toBe(true);
    expect(isColorable("firework_star")).toBe(true);
  });

  it("rejects everything else, including placeholders", () => {
    expect(isColorable("diamond_sword")).toBe(false);
    expect(isColorable("{row.material}")).toBe(false);
    expect(isColorable(undefined)).toBe(false);
  });
});

describe("readAdvanced / writeAdvanced", () => {
  it("reads the full wire shape", () => {
    expect(
      readAdvanced({
        enchants: { sharpness: 5 },
        enchanted: true,
        custom_model_data: "3",
        unbreakable: true,
        hide: ["attributes"],
        color: "#FF0000",
        nbt: "{Foo:1b}",
      }),
    ).toEqual({
      enchants: [{ id: "sharpness", level: 5 }],
      enchanted: true,
      customModelData: "3",
      unbreakable: true,
      hide: ["attributes"],
      color: "#ff0000",
      nbt: "{Foo:1b}",
    });
  });

  it("reads nothing from a bare appearance", () => {
    expect(readAdvanced({ material: "STONE" })).toEqual({});
  });

  it("coerces a numeric custom_model_data to string", () => {
    expect(readAdvanced({ custom_model_data: 7 }).customModelData).toBe("7");
  });

  it("ignores a malformed color", () => {
    expect(readAdvanced({ color: "rouge" }).color).toBeUndefined();
    expect(readAdvanced({ color: "ff0000" }).color).toBe("#ff0000");
  });

  it("writes nothing for an appearance with no advanced field", () => {
    const out: Record<string, unknown> = {};
    writeAdvanced({}, out);
    expect(out).toEqual({});
  });

  it("round-trips through the wire shape", () => {
    const domain = {
      enchants: [{ id: "sharpness", level: 5 }],
      customModelData: "3",
      unbreakable: true,
      hide: ["attributes" as const],
      color: "#ff0000",
      nbt: "{Foo:1b}",
    };
    const wire: Record<string, unknown> = {};
    writeAdvanced(domain, wire);
    expect(wire).toEqual({
      enchants: { sharpness: 5 },
      custom_model_data: "3",
      unbreakable: true,
      hide: ["attributes"],
      color: "#ff0000",
      nbt: "{Foo:1b}",
    });
    expect(readAdvanced(wire)).toEqual(domain);
  });

  it("omits `enchanted` when real enchants already carry the glint", () => {
    const wire: Record<string, unknown> = {};
    writeAdvanced({ enchants: [{ id: "sharpness", level: 1 }], enchanted: true }, wire);
    expect(wire).toEqual({ enchants: { sharpness: 1 } });
  });

  it("drops an empty enchant list rather than writing an empty map", () => {
    const wire: Record<string, unknown> = {};
    writeAdvanced({ enchants: [], hide: [] }, wire);
    expect(wire).toEqual({});
  });
});
