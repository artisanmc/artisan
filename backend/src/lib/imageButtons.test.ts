import { expect, test } from "bun:test";
import { PNG } from "pngjs";
import { strFromU8, unzipSync } from "fflate";
import { buildResourcePackZip, type AssetRow } from "./resourcePackBuilder";
import { imageButtonsFromMenus, imageButtonKey } from "./imageButtons";

test("native images keep their pixels, center by default and clip shifted pixels to their area", () => {
  const source = new PNG({ width: 8, height: 8 }); source.data.fill(255);
  for (const [offset_x, offset_y, left, top, visibleWidth] of [[0, 0, 5, 5, 8], [2, -3, 7, 2, 8], [10, 0, 15, 5, 3]]) {
    const [placement] = imageButtonsFromMenus([{ path: "menus/test.yaml", content: `
size: 27
elements:
  - id: button
    positions: 0
    image: { asset: small, fit: native, offset_x: ${offset_x}, offset_y: ${offset_y} }
` }]);
    expect(placement).toBeDefined();
    if (offset_x === 2) expect(imageButtonKey(placement!)).toBe("buttons/81db8ebbbbc69c6c6ad4a6aa92b76e0c08af547da236b9e2c9dbe1d8285a8130_18_18_native_17_2_-3");
    const built = buildResourcePackZip([], new Map([["small", PNG.sync.write(source)]]), new Map(), undefined, [], [placement!]);
    const entries = unzipSync(built.zipBytes);
    const png = PNG.sync.read(Buffer.from(entries[`assets/artisan/textures/${imageButtonKey(placement!)}.png`]!));
    const opaque = [...png.data].filter((value, i) => i % 4 === 3 && value === 255).length;
    expect(opaque).toBe(visibleWidth! * 8);
    expect(png.data[(top! * 18 + left!) * 4 + 3]).toBe(255);
    expect(png.data[(top! * 18 + left! - 1) * 4 + 3]).toBe(0);
  }
});

test("six-slot button variants are collected and emitted with their own font and sized PNG", () => {
  const placements = imageButtonsFromMenus([{ path: "menus/shop.yaml", content: `
size: 27
elements:
  - id: buy
    positions: [0-2, 9-11]
    image: { asset: buy, fit: stretch }
    states:
      - if: [{ type: has_permission, perm: vip }]
        image: { asset: vip }
` }]);
  expect(placements).toEqual([
    { asset: "buy", fit: "stretch", width: 54, height: 36, y: 17 },
    { asset: "vip", fit: "contain", width: 54, height: 36, y: 17 },
  ]);
  const png = new PNG({ width: 2, height: 1 });
  png.data.set([255, 0, 0, 255, 0, 255, 0, 255]);
  const source = PNG.sync.write(png);
  const asset = { id: "buy", name: "buy", type: "glyph", width: 2, height: 1, ascent: 1, codepoint: 0xe000, contentWidth: 2 } as AssetRow;
  const built = buildResourcePackZip([asset], new Map([["buy", source]]), new Map(), undefined, [], placements);
  const entries = unzipSync(built.zipBytes);
  const key = imageButtonKey(placements[0]!);
  const image = PNG.sync.read(Buffer.from(entries[`assets/artisan/textures/${key}.png`]!));
  expect([image.width, image.height]).toEqual([54, 36]);
  expect([...image.data.slice(0, 4)]).toEqual([255, 0, 0, 255]);
  expect([...image.data.slice(-4)]).toEqual([0, 255, 0, 255]);
  expect(JSON.parse(strFromU8(entries[`assets/artisan/font/${key}.json`]!))).toEqual({
    providers: [{ type: "bitmap", file: `artisan:${key}.png`, height: 36, ascent: -4, chars: ["\ue000"] }],
  });
  const index = JSON.parse(strFromU8(entries["assets/artisan/asset-index.json"]!));
  expect(index.assets[key]).toMatchObject({ namespace: `artisan:${key}`, width: 54 });
  expect(PNG.sync.read(source).width).toBe(2);
});

test("contain keeps proportions and transparent padding while stretch fills the rectangle", () => {
  const source = new PNG({ width: 2, height: 1 }); source.data.fill(255);
  const placement = { asset: "wide", fit: "contain" as const, width: 36, height: 36, y: 17 };
  const bytes = PNG.sync.write(source);
  const result = buildResourcePackZip([], new Map([["wide", bytes]]), new Map(), undefined, [], [placement]);
  const entries = unzipSync(result.zipBytes);
  const image = PNG.sync.read(Buffer.from(entries[`assets/artisan/textures/${imageButtonKey(placement)}.png`]!));
  expect(image.data[3]).toBe(0);
  expect(image.data[(9 * 36) * 4 + 3]).toBe(255);
  expect(image.data[(27 * 36) * 4 + 3]).toBe(0);
  expect(JSON.parse(strFromU8(entries["assets/artisan/items/buttons/hit_area.json"]!))).toEqual({ model: { type: "minecraft:empty" } });
});

test("with a hidden bottom, a button in the inventory rows or hotbar is placed like the editor places it", () => {
  const placements = imageButtonsFromMenus([{ path: "menus/shop.yaml", content: `
size: 27
player_inventory: hidden
elements:
  - id: bar
    positions: 54-56
    image: { asset: bar }
  - id: inv
    positions: [28-29, 37-38]
    image: { asset: inv }
  - id: across_gap
    positions: [45, 54]
    image: { asset: nope }
` }]);
  expect(placements).toEqual([
    { asset: "bar", fit: "contain", width: 54, height: 18, y: 142 },
    { asset: "inv", fit: "contain", width: 36, height: 36, y: 84 },
  ]);
  expect(imageButtonsFromMenus([{ path: "menus/v.yaml", content: `
size: 27
elements:
  - id: bar
    positions: 54
    image: { asset: bar }
` }])).toEqual([]);
});
