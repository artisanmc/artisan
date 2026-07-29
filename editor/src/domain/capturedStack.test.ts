import { describe, expect, it } from "vitest";
import { parseCapturedStack } from "./capturedStack";

/**
 * The two serialization shapes that actually reach us: the legacy Bukkit
 * ConfigurationSerialization form (`type` / `amount` / `meta`) and the modern
 * Paper data-component form (`id` / `count` / `components`). Both are produced
 * by `ItemDescriptor.serialize` depending on the server version, and both
 * appear as fixtures elsewhere in the repo.
 */

const LEGACY = `item:
  ==: org.bukkit.inventory.ItemStack
  v: 3465
  type: DIAMOND_SWORD
  amount: 3
  meta:
    ==: ItemMeta
    meta-type: UNSPECIFIC
    display-name: '{"text":"Épée du roi","color":"gold"}'
    lore:
      - '{"text":"Ligne une"}'
      - '{"text":"Ligne deux"}'
    enchants:
      DAMAGE_ALL: 5
      DURABILITY: 3
    Unbreakable: true
    ItemFlags:
      - HIDE_ATTRIBUTES
    custom-model-data: 42
`;

const MODERN = `item:
  ==: org.bukkit.inventory.ItemStack
  DataVersion: 4189
  id: minecraft:diamond_sword
  count: 3
  components:
    minecraft:custom_name: '{"text":"Épée du roi"}'
    minecraft:lore:
      - '{"text":"Ligne une"}'
    minecraft:enchantments:
      levels:
        minecraft:sharpness: 5
        minecraft:unbreaking: 3
    minecraft:unbreakable: {}
    minecraft:custom_model_data:
      strings:
        - custom_sword
`;

describe("parseCapturedStack — legacy Bukkit form", () => {
  const d = parseCapturedStack(LEGACY);

  it("reads material and count", () => {
    expect(d.material).toBe("DIAMOND_SWORD");
    expect(d.count).toBe(3);
  });

  it("reads the display name as plain text", () => {
    expect(d.name).toBe("Épée du roi");
  });

  it("reads the lore lines as plain text", () => {
    expect(d.lore).toEqual(["Ligne une", "Ligne deux"]);
  });

  it("reads enchantments, normalizing legacy Bukkit ids", () => {
    expect(d.enchants).toEqual([
      { id: "sharpness", level: 5 },
      { id: "unbreaking", level: 3 },
    ]);
  });

  it("reads unbreakable, hide flags and custom model data", () => {
    expect(d.unbreakable).toBe(true);
    expect(d.hide).toEqual(["attributes"]);
    expect(d.customModelData).toBe("42");
  });
});

describe("parseCapturedStack — modern component form", () => {
  const d = parseCapturedStack(MODERN);

  it("reads material and count", () => {
    expect(d.material).toBe("DIAMOND_SWORD");
    expect(d.count).toBe(3);
  });

  it("reads name and lore", () => {
    expect(d.name).toBe("Épée du roi");
    expect(d.lore).toEqual(["Ligne une"]);
  });

  it("reads enchantments from the wrapped levels map", () => {
    expect(d.enchants).toEqual([
      { id: "sharpness", level: 5 },
      { id: "unbreaking", level: 3 },
    ]);
  });

  it("reads an empty unbreakable component as true", () => {
    expect(d.unbreakable).toBe(true);
  });

  it("reads a string custom model data", () => {
    expect(d.customModelData).toBe("custom_sword");
  });
});

describe("parseCapturedStack — component variants", () => {
  it("reads the unwrapped enchantments map (1.21.5+)", () => {
    const d = parseCapturedStack(`item:
  id: minecraft:bow
  components:
    minecraft:enchantments:
      minecraft:power: 5
`);
    expect(d.enchants).toEqual([{ id: "power", level: 5 }]);
  });

  it("reads a packed dyed_color int and the wrapped form", () => {
    expect(
      parseCapturedStack(`item:
  id: minecraft:leather_boots
  components:
    minecraft:dyed_color: 16711680
`).color,
    ).toBe("#ff0000");
    expect(
      parseCapturedStack(`item:
  id: minecraft:leather_boots
  components:
    minecraft:dyed_color:
      rgb: 16711680
`).color,
    ).toBe("#ff0000");
  });

  it("reads a numeric custom model data from the floats component", () => {
    const d = parseCapturedStack(`item:
  id: minecraft:paper
  components:
    minecraft:custom_model_data:
      floats:
        - 7
`);
    expect(d.customModelData).toBe("7");
  });

  it("reads the glint override", () => {
    const d = parseCapturedStack(`item:
  id: minecraft:paper
  components:
    minecraft:enchantment_glint_override: true
`);
    expect(d.enchanted).toBe(true);
  });

  it("reads the head texture from the profile component", () => {
    const d = parseCapturedStack(`item:
  id: minecraft:player_head
  components:
    minecraft:profile:
      properties:
        - name: textures
          value: eyJ0ZXh0dXJlcyI6e319
`);
    expect(d.headTexture).toBe("eyJ0ZXh0dXJlcyI6e319");
    expect(d.material).toBe("PLAYER_HEAD");
  });

  it("derives a nexo custom id as the material ref", () => {
    const d = parseCapturedStack(`item:
  id: minecraft:paper
  components:
    minecraft:custom_data:
      nexo:id: arcanist_key
`);
    expect(d.material).toBe("nexo:arcanist_key");
  });
});

describe("parseCapturedStack — JSON/SNBT-encoded components", () => {
  // Paper serializes component values as an encoded string, not a nested map.
  it("reads enchantments from a JSON-string component", () => {
    const d = parseCapturedStack(`item:
  ==: org.bukkit.inventory.ItemStack
  DataVersion: 4671
  id: minecraft:diamond_sword
  count: 1
  components:
    minecraft:enchantments: '{"minecraft:bane_of_arthropods":1}'
  schema_version: 1
`);
    expect(d.material).toBe("DIAMOND_SWORD");
    expect(d.enchants).toEqual([{ id: "bane_of_arthropods", level: 1 }]);
  });

  it("reads the wrapped levels form when encoded as a string", () => {
    const d = parseCapturedStack(`item:
  id: minecraft:bow
  components:
    minecraft:enchantments: '{"levels":{"minecraft:power":3}}'
`);
    expect(d.enchants).toEqual([{ id: "power", level: 3 }]);
  });

  it("tolerates real SNBT — bare keys and typed number suffixes", () => {
    const d = parseCapturedStack(`item:
  id: minecraft:diamond_sword
  components:
    minecraft:enchantments: '{minecraft:sharpness:5s,minecraft:mending:1b}'
`);
    expect(d.enchants).toEqual([
      { id: "sharpness", level: 5 },
      { id: "mending", level: 1 },
    ]);
  });

  it("reads an encoded dyed_color, custom model data and profile", () => {
    const d = parseCapturedStack(`item:
  id: minecraft:leather_boots
  components:
    minecraft:dyed_color: '{"rgb":16711680}'
    minecraft:custom_model_data: '{"strings":["boot"]}'
    minecraft:profile: '{"properties":[{"name":"textures","value":"eyJ0ZXh0In0="}]}'
`);
    expect(d.color).toBe("#ff0000");
    expect(d.customModelData).toBe("boot");
    expect(d.headTexture).toBe("eyJ0ZXh0In0=");
  });

  it("reads an encoded lore array", () => {
    const d = parseCapturedStack(`item:
  id: minecraft:paper
  components:
    minecraft:lore: '["{\\"text\\":\\"Ligne\\"}"]'
`);
    expect(d.lore).toEqual(["Ligne"]);
  });

  it("still reads a name that is a plain JSON text component", () => {
    // custom_name is a text component, NOT a container — must not be
    // mistaken for an encoded object and lose its text.
    const d = parseCapturedStack(`item:
  id: minecraft:paper
  components:
    minecraft:custom_name: '{"text":"Clé"}'
`);
    expect(d.name).toBe("Clé");
  });

  it("leaves an undecodable component alone instead of throwing", () => {
    expect(() =>
      parseCapturedStack(`item:
  id: minecraft:paper
  components:
    minecraft:enchantments: '{ this is not parseable at all ][ '
`),
    ).not.toThrow();
  });
});

describe("parseCapturedStack — legacy variants", () => {
  it("reads a legacy Color map", () => {
    const d = parseCapturedStack(`item:
  type: LEATHER_BOOTS
  meta:
    color:
      ==: Color
      RED: 255
      GREEN: 0
      BLUE: 0
`);
    expect(d.color).toBe("#ff0000");
  });

  it("reads a plain (non-JSON) display name", () => {
    expect(
      parseCapturedStack(`item:
  type: PAPER
  meta:
    display-name: Simple
`).name,
    ).toBe("Simple");
  });

  it("joins the extra components of a JSON name", () => {
    expect(
      parseCapturedStack(`item:
  type: PAPER
  meta:
    display-name: '{"text":"Clé ","extra":[{"text":"Luxury"}]}'
`).name,
    ).toBe("Clé Luxury");
  });
});

describe("parseCapturedStack — tolerance", () => {
  it("accepts a document with no `item:` wrapper", () => {
    const d = parseCapturedStack(`==: org.bukkit.inventory.ItemStack
type: DIAMOND
amount: 2
`);
    expect(d.material).toBe("DIAMOND");
    expect(d.count).toBe(2);
  });

  it("omits a count of 1 rather than stating the default", () => {
    expect(parseCapturedStack("item:\n  type: DIAMOND\n  amount: 1\n").count).toBeUndefined();
  });

  it("returns an empty result on malformed YAML instead of throwing", () => {
    expect(parseCapturedStack("::: not yaml :::\n  - [")).toEqual({});
    expect(parseCapturedStack("")).toEqual({});
  });

  it("returns an empty result on a YAML scalar", () => {
    expect(parseCapturedStack("42")).toEqual({});
  });
});
