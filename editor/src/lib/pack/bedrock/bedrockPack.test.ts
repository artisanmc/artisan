// @vitest-environment node

import { readFileSync } from "node:fs";
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, test } from "vitest";
import type { AssetRow } from "../fontJsonBuilder";
import { createImage, decodePng, encodePng } from "../png";
import { type BedrockMenu, bedrockMenusFromProject, leadingColor } from "./bedrockMenus";
import { buildBedrockPack } from "./bedrockPack";
import {
  BEDROCK_MARKER,
  BEDROCK_PAD,
  BEDROCK_PAD2,
  TEXTAREA_FIELD,
  TEXT_FIELD,
  bedrockButtonPair,
  bedrockField,
  bedrockFieldOffset,
  bedrockMenuKey,
} from "./bedrockTitle";
import { LEAD_CANDIDATES, labelColor } from "./bedrockUi";

const chest = new Uint8Array(
  readFileSync(new URL("../../../assets/minecraft/generic_54.png", import.meta.url)),
);

function solid(w: number, h: number, rgba: number[]): Uint8Array {
  const img = createImage(w, h);
  for (let i = 0; i < w * h; i++) img.data.set(rgba, i * 4);
  return encodePng(img);
}

const SHOP = `id: shop
size: 54
vanilla_texture: false
title:
  - kind: background
    asset: frame
  - kind: text
    value: "Hello {player.name}"
    x: 20
    y: 30
    color: gold
    size: 16
  - kind: glyph
    asset: coin
    x: 100
    y: 40
  - kind: textarea
    value: "lines"
    x: 10
    y: 60
    width: 80
    line_height: 9
    alignment: center
elements:
  - id: buy
    positions: "30-32"
    image: { asset: buy, fit: stretch }
    states:
      - if: [{ type: has_permission, perm: vip }]
        title: VIP
      - if: [{ type: has_permission, perm: gold }]
        image: { asset: buy_gold, fit: contain, offset_x: 1 }
  - id: list
    positions: "0-8"
    iterates: { source: items, alias: it }
    image: { asset: buy }
`;

const PLAIN = "id: info\nsize: 27\ntitle: Plain title\n";

const files = [
  { path: "menus/shop.yaml", content: SHOP },
  { path: "menus/info.yaml", content: PLAIN },
  { path: "menus/hopper.yaml", content: "id: h\nsize: 5\ninventory_type: hopper\n" },
  { path: "menus/four.yaml", content: "id: four\nsize: 36\n" },
  { path: "menus/hidden.yaml", content: "id: hid\nsize: 27\nplayer_inventory: hidden\n" },
  { path: "menus/broken.yaml", content: "title: [" },
];

describe("bedrockTitle", () => {
  test("keys are two characters of the blank page, stable, and never the marker", () => {
    const key = bedrockMenuKey("lobby", "shop");
    expect(key).toBe(bedrockMenuKey("lobby", "shop"));
    expect(key).not.toBe(bedrockMenuKey("lobby", "shop2"));
    // A variant's menu: sha256("guilds:main@textured") starts with 0x9d 0x8b (same in BedrockTitleTest.kt).
    expect(bedrockMenuKey("guilds", "main", "textured")).toBe("\uF89E\uF88C");
    expect(bedrockMenuKey("guilds", "main", "")).toBe(bedrockMenuKey("guilds", "main"));
    expect([...key]).toHaveLength(2);
    for (const c of key) {
      const cp = c.codePointAt(0) as number;
      expect(cp).toBeGreaterThanOrEqual(0xf880);
      expect(cp).toBeLessThan(0xf8ff);
    }
    expect(BEDROCK_MARKER).toBe("");
  });

  test("button pairs come from disjoint ranges and fields follow them", () => {
    expect(bedrockButtonPair(0, 0)).toBe("");
    expect(bedrockButtonPair(5, 2)).toBe("");
    // Offsets are UTF-8 bytes: every control character takes 3.
    expect(bedrockFieldOffset(2, [TEXT_FIELD, TEXTAREA_FIELD], 0)).toBe(21);
    expect(bedrockFieldOffset(2, [TEXT_FIELD, TEXTAREA_FIELD], 1)).toBe(21 + TEXT_FIELD);
  });

  test("a field is exactly its bytes, cut at a character boundary, padded with PAD then spaces (BedrockTitleTest)", () => {
    const bytes = (s: string) => new TextEncoder().encode(s).length;
    const ascii = bedrockField("Bien le bonjour bedrock!", 64);
    expect(bytes(ascii)).toBe(64);
    // 40 free bytes: 12 PAD + 2 PAD2, no space left to shift a centred line.
    expect(ascii).toBe(
      `Bien le bonjour bedrock!${BEDROCK_PAD.repeat(12)}${BEDROCK_PAD2.repeat(2)}`,
    );
    expect(bedrockField("é", 7)).toBe(`é${BEDROCK_PAD}${BEDROCK_PAD2}`);
    expect(bedrockField("aaé", 3)).toBe("aa ");
    expect(bytes(bedrockField("€€€€€", 10))).toBe(10);
  });
});

describe("bedrockMenusFromProject", () => {
  const menus = bedrockMenusFromProject("lobby", files);

  test("keeps chests of 3 and 6 rows with a visible player inventory", () => {
    expect(menus.map((m) => [m.id, m.rows, m.transparent])).toEqual([
      ["shop", 6, true],
      ["info", 3, false],
    ]);
    expect(menus[0]?.key).toBe(bedrockMenuKey("lobby", "shop"));
  });

  test("a layer without color takes the color tag its value opens with", () => {
    expect(leadingColor("<white>Bien le bonjour")).toBe("white");
    expect(leadingColor("<#ff8800>x")).toBe("#ff8800");
    expect(leadingColor("<color:gold>x")).toBe("gold");
    expect(leadingColor("plain <red>x")).toBeUndefined();
    expect(leadingColor({ en: "<white>x" })).toBeUndefined();
  });

  test("takes the id from the file name, as the plugin does, themed folders included", () => {
    const saved = [
      // The editor saves a menu without `id:`; a stale one in the file is ignored.
      { path: "menus/test.yml", content: "schema: menu/v1\nsize: 54\n" },
      { path: "boutique/menus/swords.yaml", content: "id: other\nsize: 27\n" },
    ];
    expect(bedrockMenusFromProject("lobby", saved).map((m) => [m.id, m.key])).toEqual([
      ["test", bedrockMenuKey("lobby", "test")],
      ["swords", bedrockMenuKey("lobby", "swords")],
    ]);
  });

  test("reads image layers in order, text layers as fields, image buttons with states", () => {
    const shop = menus[0] as BedrockMenu;
    expect(shop.images).toEqual([
      { asset: "frame", x: 0, y: null },
      { asset: "coin", x: 100, y: 40 },
    ]);
    expect(shop.texts).toEqual([
      { index: 0, length: TEXT_FIELD, x: 20, y: 30, scale: 2, color: "gold" },
      {
        index: 1,
        length: TEXTAREA_FIELD,
        x: 10,
        y: 60,
        scale: 1,
        color: undefined,
        width: 80,
        alignment: "center",
      },
    ]);
    // The iterating element is no button; the state without an image is skipped.
    expect(shop.buttons).toEqual([
      {
        index: 0,
        x: 7 + 3 * 18,
        y: 17 + 3 * 18,
        width: 54,
        height: 18,
        images: [
          { asset: "buy", fit: "stretch", state: 0 },
          { asset: "buy_gold", fit: "contain", offset_x: 1, state: 2 },
        ],
      },
    ]);
    const info = menus[1] as BedrockMenu;
    expect(info.texts).toEqual([
      { index: 0, length: TEXT_FIELD, x: 8, y: 6, scale: 1, color: undefined },
    ]);
  });
});

describe("labelColor", () => {
  test("hex, names and the chest default", () => {
    expect(labelColor("#ff0000")).toEqual([1, 0, 0]);
    expect(labelColor("gold")).toEqual([1, 0.667, 0]);
    expect(labelColor(undefined)).toEqual([0.251, 0.251, 0.251]);
    expect(labelColor("nope")).toEqual([0.251, 0.251, 0.251]);
  });
});

describe("buildBedrockPack", () => {
  const assets = [
    { id: "frame", name: "frame", type: "glyph", ascent: 13, height: 100, width: 176 },
    { id: "coin", name: "coin", type: "glyph", ascent: 5, height: 8, width: 8 },
  ] as unknown as AssetRow[];
  const pngs = new Map<string, Uint8Array>([
    ["frame", solid(176, 100, [0, 0, 255, 255])],
    ["coin", solid(8, 8, [255, 255, 0, 255])],
    ["buy", solid(4, 4, [0, 255, 0, 255])],
    ["buy_gold", solid(4, 4, [255, 128, 0, 128])],
  ]);
  const menus = bedrockMenusFromProject("lobby", files);
  const build = () =>
    buildBedrockPack({ serverId: "srv", menus, pngs, assets, chestTexture: chest });

  test("is deterministic and versioned by content", () => {
    const a = build();
    const b = build();
    expect(a.hash).toBe(b.hash);
    const manifest = JSON.parse(strFromU8(a.files["manifest.json"] as Uint8Array));
    expect(manifest.header.uuid).toMatch(/^[0-9a-f-]{36}$/);
    const other = buildBedrockPack({
      serverId: "srv",
      menus: menus.slice(1),
      pngs,
      assets,
      chestTexture: chest,
    });
    const manifest2 = JSON.parse(strFromU8(other.files["manifest.json"] as Uint8Array));
    expect(manifest2.header.uuid).toBe(manifest.header.uuid);
    expect(manifest2.header.version).not.toEqual(manifest.header.version);
    expect(Object.keys(unzipSync(a.bytes)).sort()).toEqual(Object.keys(a.files).sort());
  });

  test("composes each background: vanilla top under a styled menu, nothing under a transparent one", () => {
    const { files: out } = build();
    const shop = menus[0] as BedrockMenu;
    const info = menus[1] as BedrockMenu;
    const shopBg = decodePng(
      out[`textures/artisan/menus/artisan_${hex(shop.key)}_bg.png`] as Uint8Array,
    );
    // The frame (ascent 13 → y 0, 100 tall) then the coin at (100, 40).
    expect([shopBg.width, shopBg.height]).toEqual([176, 100]);
    expect([...shopBg.data.subarray(0, 4)]).toEqual([0, 0, 255, 255]);
    expect([...shopBg.data.subarray((40 * 176 + 100) * 4, (40 * 176 + 100) * 4 + 4)]).toEqual([
      255, 255, 0, 255,
    ]);
    const infoBg = decodePng(
      out[`textures/artisan/menus/artisan_${hex(info.key)}_bg.png`] as Uint8Array,
    );
    expect([infoBg.width, infoBg.height]).toEqual([176, 17 + 3 * 18]);
    // The window corner is transparent; the title bar is not.
    expect(infoBg.data[(10 * 176 + 10) * 4 + 3]).toBe(255);
  });

  test("draws button images once per geometry and places the screen's elements", () => {
    const { files: out } = build();
    const shop = menus[0] as BedrockMenu;
    const screen = JSON.parse(strFromU8(out["ui/chest_screen.json"] as Uint8Array));
    expect(screen.namespace).toBe("chest");
    expect(Object.keys(screen).sort()).toEqual([
      "artisan_grid_item@common.container_item",
      "large_chest_panel/root_panel",
      "namespace",
      "small_chest_panel/root_panel",
    ]);
    const large = screen["large_chest_panel/root_panel"].modifications;
    // The transparent menu hides the vanilla panel; the small one (styled) does not.
    expect(large.map((m: { operation: string }) => m.operation)).toEqual([
      "replace",
      "replace",
      "insert_back",
    ]);
    expect(screen["small_chest_panel/root_panel"].modifications).toHaveLength(1);
    const inserted = Object.assign({}, ...large[2].value) as Record<
      string,
      Record<string, unknown>
    >;
    const names = Object.keys(inserted);
    const k = hex(shop.key);
    expect(names).toEqual([
      `artisan_${k}_bg`,
      "artisan_chest_grid@chest.large_chest_grid",
      `artisan_${k}_b0_0`,
      `artisan_${k}_b0_2`,
      ...LEAD_CANDIDATES.map((lead) => `artisan_${k}_t0_${lead}`),
      ...LEAD_CANDIDATES.map((lead) => `artisan_${k}_t1_${lead}`),
    ]);
    const bg = inserted[`artisan_${k}_bg`] as Record<string, unknown>;
    expect(bg.offset).toEqual([0, 4]);
    expect(bg.size).toEqual([176, 100]);
    expect(bg.visible).toBe(
      `(not (($artisan_title - '${BEDROCK_MARKER}${shop.key}') = $artisan_title))`,
    );
    const b0 = inserted[`artisan_${k}_b0_0`] as Record<string, unknown>;
    expect(b0.offset).toEqual([7 + 54, 17 + 54 + 4]);
    expect(b0.size).toEqual([54, 18]);
    expect(String(b0.visible)).toContain(`'${bedrockButtonPair(0, 0)}'`);
    expect(out[`${b0.texture}.png`]).toBeDefined();
    const strip = `- '${BEDROCK_PAD}') - '${BEDROCK_PAD2}')`;
    const t0 = inserted[`artisan_${k}_t0_0`] as Record<string, unknown>;
    expect(t0.text).toBe(
      `((('%.${TEXT_FIELD}s' * ($artisan_title - ('%.15s' * $artisan_title))) ${strip}`,
    );
    // The label for 0 lead bytes shows only when the marker and key open the title.
    expect(t0.visible).toBe(
      `((not (($artisan_title - '${BEDROCK_MARKER}${shop.key}') = $artisan_title)) and (('%.9s' * $artisan_title) = '${BEDROCK_MARKER}${shop.key}'))`,
    );
    expect(t0.offset).toEqual([20, 33]);
    expect(t0.font_scale_factor).toBe(2);
    expect(t0.color).toEqual([1, 0.667, 0]);
    // 12 lead bytes (Geyser's §r and what the proxy chain adds): every cut moves by 12.
    const t0at12 = inserted[`artisan_${k}_t0_12`] as Record<string, unknown>;
    expect(t0at12.text).toBe(
      `((('%.${TEXT_FIELD}s' * ($artisan_title - ('%.27s' * $artisan_title))) ${strip}`,
    );
    expect(String(t0at12.visible)).toContain(
      `((('%.21s' * $artisan_title) - ('%.12s' * $artisan_title)) = '${BEDROCK_MARKER}${shop.key}')`,
    );
    const t1 = inserted[`artisan_${k}_t1_0`] as Record<string, unknown>;
    expect(t1.text).toBe(
      `((('%.${TEXTAREA_FIELD}s' * ($artisan_title - ('%.${15 + TEXT_FIELD}s' * $artisan_title))) ${strip}`,
    );
    expect(t1.size).toEqual([80, "default"]);
    // A centred textarea's x is the middle of its lines, as on Java.
    expect(t1.offset).toEqual([10 - 40, 63]);
    expect(t1.text_alignment).toBe("center");
    expect(out["textures/items/artisan_hit_area.png"]).toBeDefined();
    expect(out["font/glyph_F8.png"]).toBeDefined();
  });
});

const hex = (key: string) =>
  [...key].map((c) => (c.codePointAt(0) as number).toString(16)).join("");
